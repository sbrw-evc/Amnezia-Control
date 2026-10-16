import time

from ..db.base import Database
from ..db.repositories import SettingRepo

DEFAULTS = {
    "client_dns": "1.1.1.1, 1.0.0.1",
    "endpoint_host": "",
    "poll_seconds": 10,
    "retention_days": 90,
    "quota_warn_percent": 80,
    "expiry_warn_days": 3,
    "default_quota_gb": None,
    "default_valid_days": None,
    "share_link_hours": 24,
    "timezone": "Europe/Moscow",
    "gateway_stale_minutes": 5,
    "notify_enabled": False,
    "notify_min_severity": "warning",
    "notify_telegram_chat_id": "",
    "backup_enabled": True,
    "backup_keep": 14,
    "mt_endpoint_host": "",
    "mt_client_dns": "",
    "mt_allowed_ips": "0.0.0.0/0",
    "endpoint_offline_minutes": 15,
    "endpoint_retention_days": 90,
    "flow_collector_host": "",
    "flow_collector_port": 2055,
    "threat_enabled": True,
    "threat_refresh_hours": 6,
    "threat_lists": None,
    "threat_exclude": "",
    "rdns_enabled": True,
    "threat_status": None,
    # The state of the SPA connection (services/identity/spa.py): last synchronisation, its ETag, counts, errors and
    # the configuration SPA gave (application name, account and sign-out addresses).
    "spa": None,
}


# Kept by their services; not listed or changed through the general settings API.
PRIVATE = frozenset({"spa"})


class SettingsService:
    TTL = 15

    def __init__(self, db: Database):
        self._db = db
        self._cache: dict | None = None
        self._loaded = 0.0

    async def _load(self) -> dict:
        if self._cache is None or time.monotonic() - self._loaded > self.TTL:
            self._loaded = time.monotonic()
            async with self._db.session() as s:
                stored = await SettingRepo(s).get_all()
            self._cache = {**DEFAULTS, **{k: v for k, v in stored.items() if k in DEFAULTS}}
        return self._cache

    async def all(self) -> dict:
        return {k: v for k, v in (await self._load()).items() if k not in PRIVATE}

    async def get(self, key: str):
        return (await self._load())[key]

    async def put_private(self, key: str, value) -> None:
        """Stores one of the private settings (kept by its service)."""
        if key not in PRIVATE:
            raise ValueError(key)
        async with self._db.session() as s:
            await SettingRepo(s).put(key, value)
        self._cache = None

    async def update(self, values: dict) -> dict:
        unknown = set(values) - (set(DEFAULTS) - PRIVATE)
        if unknown:
            raise ValueError(f"Unknown settings: {', '.join(sorted(unknown))}")
        async with self._db.session() as s:
            repo = SettingRepo(s)
            for k, v in values.items():
                await repo.put(k, v)
        self._cache = None
        return await self.all()
