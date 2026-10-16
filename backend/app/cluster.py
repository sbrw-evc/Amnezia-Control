from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from contextlib import asynccontextmanager

import asyncpg

from .services.common import EventBus

log = logging.getLogger(__name__)
CHANNEL = "network_control_events"
LEADER_KEY = 7_331_001
CONFIG_LOCK_KEY = 7_331_002
NOTIFY_LIMIT = 7900


def plain_dsn(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+asyncpg://", "postgresql://", 1)


class PgEventBus(EventBus):
    def __init__(self, dsn: str):
        super().__init__()
        self._dsn = dsn
        self._listen: asyncpg.Connection | None = None
        self._send: asyncpg.Connection | None = None
        self._send_lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._keep_listening(), name="pg-listen")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        for c in (self._listen, self._send):
            if c is not None:
                await c.close()

    async def _keep_listening(self) -> None:
        while True:
            try:
                self._listen = await asyncpg.connect(self._dsn)
                await self._listen.add_listener(CHANNEL, self._on_notify)
                while not self._listen.is_closed():
                    await asyncio.sleep(5)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("event listener reconnecting: %s", e)
            await asyncio.sleep(2)

    def _on_notify(self, _conn, _pid, _channel, payload: str) -> None:
        msg = json.loads(payload)
        self._deliver(msg["event"], msg["data"])

    def _deliver(self, event: str, data: dict) -> None:
        super().publish(event, data)

    def publish(self, event: str, data: dict) -> None:
        payload = json.dumps({"event": event, "data": data}, default=str, separators=(",", ":"))
        if len(payload) > NOTIFY_LIMIT:
            payload = json.dumps({"event": event, "data": {"truncated": True}})
        asyncio.get_running_loop().create_task(self._notify(payload))

    async def _notify(self, payload: str) -> None:
        async with self._send_lock:
            try:
                if self._send is None or self._send.is_closed():
                    self._send = await asyncpg.connect(self._dsn)
                await self._send.execute("SELECT pg_notify($1, $2)", CHANNEL, payload)
            except Exception as e:
                log.warning("notify failed: %s", e)
                self._send = None


class LeaderElection:
    def __init__(self, dsn: str, on_elected, on_lost):
        self._dsn = dsn
        self._on_elected = on_elected
        self._on_lost = on_lost
        self._task: asyncio.Task | None = None
        self.is_leader = False

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="leader-election")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def _run(self) -> None:
        conn: asyncpg.Connection | None = None
        while True:
            try:
                if conn is None or conn.is_closed():
                    conn = await asyncpg.connect(self._dsn)
                if not self.is_leader:
                    if await conn.fetchval("SELECT pg_try_advisory_lock($1)", LEADER_KEY):
                        self.is_leader = True
                        log.info("this worker is now the leader")
                        await self._on_elected()
                else:
                    await conn.fetchval("SELECT 1")
            except asyncio.CancelledError:
                if conn is not None and not conn.is_closed():
                    await conn.close()
                raise
            except Exception as e:
                log.warning("leader election: %s", e)
                if self.is_leader:
                    self.is_leader = False
                    await self._on_lost()
                conn = None
            await asyncio.sleep(10)


class DistributedLock:
    def __init__(self, dsn: str, key: int):
        self._dsn = dsn
        self._key = key
        self._local = asyncio.Lock()

    @asynccontextmanager
    async def hold(self):
        async with self._local:
            conn = await asyncpg.connect(self._dsn)
            try:
                await conn.execute("SELECT pg_advisory_lock($1)", self._key)
                yield
            finally:
                await conn.execute("SELECT pg_advisory_unlock($1)", self._key)
                await conn.close()


class LiveState:
    def __init__(self, bus: EventBus, size: int = 240):
        self.history: deque = deque(maxlen=size)
        self.rates: dict[str, dict] = {}
        self.server_ok = True
        self._q = bus.subscribe()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._consume(), name="live-state")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _consume(self) -> None:
        while True:
            ev = await self._q.get()
            if ev["event"] != "live":
                continue
            d = ev["data"]
            self.server_ok = d.get("server_ok", True)
            if "clients" in d:
                self.rates = d["clients"]
            if d.get("t") and d.get("elapsed"):
                self.history.append({k: d[k] for k in ("t", "rx", "tx", "online")})
