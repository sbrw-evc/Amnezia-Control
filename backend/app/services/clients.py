from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import secrets
import uuid

from ..adapters.amnezia import AwgConfigCodec
from ..db.base import Database
from ..db.models import ShareLink, VpnClient
from ..db.repositories import ClientRepo, ConnectionRepo, ShareRepo, TrafficRepo
from ..domain.errors import DomainError, NotFound
from ..domain.models import BlockReason, ClientStatus, PeerEntry
from ..ports import SecretStore, VpnServerGateway
from .audit import AuditService
from .common import Actor, EventBus, utcnow
from .configs import ClientBundle, ClientConfigBuilder
from .server import ServerConfigEditor, generate_keypair
from .settings import SettingsService

ONLINE_SECONDS = 180
GB = 1024 ** 3


def month_start(now: dt.datetime | None = None) -> dt.datetime:
    now = now or utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def iso(v: dt.datetime | None) -> str | None:
    return v.isoformat() if v else None


class ClientView:
    @staticmethod
    def dto(c: VpnClient, month: tuple[int, int] = (0, 0), live: dict | None = None) -> dict:
        used = month[0] + month[1]
        now = utcnow()
        online = bool(c.last_handshake_at and (now - c.last_handshake_at).total_seconds() < ONLINE_SECONDS)
        live = live or {}
        return {
            "id": str(c.id), "public_key": c.public_key, "name": c.name, "owner": c.owner, "contact": c.contact,
            "tags": c.tags or [], "note": c.note, "address": c.address, "status": c.status.value,
            "block_reason": c.block_reason.value if c.block_reason else None, "managed": c.managed, "system": c.system,
            "expires_at": iso(c.expires_at), "quota_bytes": c.quota_bytes,
            "quota_used_bytes": used, "quota_percent": round(used * 100 / c.quota_bytes, 1) if c.quota_bytes else None,
            "month_rx": month[1], "month_tx": month[0],
            "total_rx": c.total_tx, "total_tx": c.total_rx,
            "online": online and c.status == ClientStatus.ACTIVE, "last_handshake_at": iso(c.last_handshake_at),
            "endpoint": c.last_endpoint, "country_code": c.country_code, "country": c.country, "city": c.city,
            "lat": c.lat, "lon": c.lon, "rate_rx": live.get("rx", 0), "rate_tx": live.get("tx", 0),
            "created_at": iso(c.created_at), "created_by": c.created_by, "config_downloaded_at": iso(c.config_downloaded_at),
        }


class VpnClientService:
    def __init__(self, db: Database, editor: ServerConfigEditor, gateway: VpnServerGateway, secrets_store: SecretStore,
                 builder: ClientConfigBuilder, settings: SettingsService, audit: AuditService, bus: EventBus,
                 default_host: str, public_base_url: str, live):
        self._live = live
        self._db = db
        self._editor = editor
        self._gw = gateway
        self._secrets = secrets_store
        self._builder = builder
        self._settings = settings
        self._audit = audit
        self._bus = bus
        self._default_host = default_host
        self._public_base = public_base_url.rstrip("/")

    @staticmethod
    def _secret_path(client_id: uuid.UUID) -> str:
        return f"clients/{client_id}"


    async def list(self, q: str | None = None, status: str | None = None, tag: str | None = None) -> list[dict]:
        async with self._db.session() as s:
            clients = await ClientRepo(s).search(q, status, tag)
            month = await TrafficRepo(s).totals_by_client(month_start())
        return [ClientView.dto(c, month.get(c.id, (0, 0)), self._live.rates.get(str(c.id))) for c in clients]

    async def get(self, client_id: uuid.UUID) -> dict:
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            month = await TrafficRepo(s).totals_by_client(month_start())
            sessions = await ConnectionRepo(s).for_client(c.id, 50)
        d = ClientView.dto(c, month.get(c.id, (0, 0)), self._live.rates.get(str(c.id)))
        d["connections"] = [{"ts": iso(e.ts), "ip": e.ip, "port": e.port, "country_code": e.country_code,
                             "country": e.country, "city": e.city} for e in sessions]
        return d

    async def tags(self) -> list[str]:
        async with self._db.session() as s:
            return await ClientRepo(s).all_tags()


    async def create(self, actor: Actor, *, name: str, owner: str = "", contact: str = "", tags: list[str] | None = None,
                     note: str = "", expires_at: dt.datetime | None = None, quota_gb: float | None = None) -> dict:
        name = name.strip()[:128]
        if not name:
            raise DomainError("Укажите имя клиента")
        keys = generate_keypair()
        psk = await self._gw.preshared_key()
        async with self._editor.edit() as cfg:
            address = cfg.free_address()
            lines = AwgConfigCodec.peer_lines(keys.public_key, psk, address)
            cfg.peers.append(PeerEntry(keys.public_key, address, psk, False, lines))
        client_id = uuid.uuid4()
        await self._secrets.put(self._secret_path(client_id), {"private_key": keys.private_key,
                                                               "public_key": keys.public_key})
        await self._table_upsert(keys.public_key, name, address)
        async with self._db.session() as s:
            c = ClientRepo(s).add(VpnClient(
                id=client_id, public_key=keys.public_key, name=name, owner=owner, contact=contact, tags=self._tags(tags),
                note=note, address=address, managed=True, created_by=actor.username, expires_at=expires_at,
                quota_bytes=int(quota_gb * GB) if quota_gb else None))
            self._audit.record(s, actor, "client.created", "client", c.id, name, address=address)
        self._bus.publish("clients", {"id": str(client_id)})
        return await self.get(client_id)

    async def update(self, actor: Actor, client_id: uuid.UUID, fields: dict) -> dict:
        allowed = {"name", "owner", "contact", "tags", "note", "expires_at", "quota_gb"}
        fields = {k: v for k, v in fields.items() if k in allowed}
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            changes = {}
            for k, v in fields.items():
                if k == "quota_gb":
                    k, v = "quota_bytes", int(v * GB) if v else None
                elif k == "tags":
                    v = self._tags(v)
                elif k == "name":
                    v = (v or "").strip()[:128] or c.name
                if getattr(c, k) != v:
                    changes[k] = str(v)
                    setattr(c, k, v)
            self._audit.record(s, actor, "client.updated", "client", c.id, c.name, **changes)
            pub, name, address = c.public_key, c.name, c.address
        if "name" in changes:
            await self._table_upsert(pub, name, address)
        self._bus.publish("clients", {"id": str(client_id)})
        return await self.get(client_id)

    async def set_blocked(self, actor: Actor, client_id: uuid.UUID, blocked: bool,
                          reason: BlockReason = BlockReason.MANUAL) -> dict:
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            if c.system and blocked:
                raise DomainError("Системный клиент (домашний шлюз) нельзя блокировать")
            pub = c.public_key
        async with self._editor.edit() as cfg:
            peer = cfg.peer(pub)
            if not peer:
                raise NotFound("Пир не найден в конфиге сервера — выполните синхронизацию")
            peer.disabled = blocked
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            c.status = ClientStatus.BLOCKED if blocked else ClientStatus.ACTIVE
            c.block_reason = reason if blocked else None
            self._audit.record(s, actor, "client.blocked" if blocked else "client.unblocked", "client", c.id, c.name,
                               reason=reason.value if blocked else None)
        self._bus.publish("clients", {"id": str(client_id)})
        return await self.get(client_id)

    async def reissue(self, actor: Actor, client_id: uuid.UUID) -> dict:
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            old_pub, name = c.public_key, c.name
        keys = generate_keypair()
        async with self._editor.edit() as cfg:
            peer = cfg.peer(old_pub)
            if not peer:
                raise NotFound("Пир не найден в конфиге сервера")
            peer.lines = [f"PublicKey = {keys.public_key}" if l.strip().startswith("PublicKey") else l for l in peer.lines]
            peer.public_key = keys.public_key
        await self._secrets.put(self._secret_path(client_id), {"private_key": keys.private_key,
                                                               "public_key": keys.public_key})
        await self._table_rekey(old_pub, keys.public_key, name)
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            c.public_key, c.managed, c.raw_rx, c.raw_tx, c.config_downloaded_at = keys.public_key, True, 0, 0, None
            self._audit.record(s, actor, "client.reissued", "client", c.id, c.name)
        self._bus.publish("clients", {"id": str(client_id)})
        return await self.get(client_id)

    async def delete(self, actor: Actor, client_id: uuid.UUID) -> None:
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            if c.system:
                raise DomainError("Системный клиент (домашний шлюз) нельзя удалить из панели")
            pub = c.public_key
        async with self._editor.edit() as cfg:
            cfg.peers = [p for p in cfg.peers if p.public_key != pub]
        await self._table_remove(pub)
        await self._secrets.delete(self._secret_path(client_id))
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            self._audit.record(s, actor, "client.deleted", "client", c.id, c.name, address=c.address)
            await s.delete(c)
        self._bus.publish("clients", {"id": str(client_id), "deleted": True})

    async def bulk(self, actor: Actor, ids: list[uuid.UUID], action: str) -> dict:
        ops = {"block": lambda i: self.set_blocked(actor, i, True), "unblock": lambda i: self.set_blocked(actor, i, False),
               "delete": lambda i: self.delete(actor, i)}
        if action not in ops:
            raise DomainError("Неизвестное действие")
        done, failed = 0, []
        for i in ids:
            try:
                await ops[action](i)
                done += 1
            except DomainError as e:
                failed.append({"id": str(i), "error": e.message})
        return {"done": done, "failed": failed}


    async def bundle(self, actor: Actor | None, client_id: uuid.UUID) -> ClientBundle:
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            if not c.managed:
                raise DomainError("Ключ этого клиента панели неизвестен (создан вне панели). "
                                  "Перевыпустите ключи, чтобы получить конфиг.")
            secret = await self._secrets.get(self._secret_path(c.id))
            if not secret:
                raise DomainError("Ключ клиента не найден в OpenBao. Перевыпустите ключи.")
            st = await self._settings.all()
            server = await self._editor.load()
            bundle = await asyncio.to_thread(
                self._builder.build, name=c.name, server=server, server_public_key=await self._gw.server_public_key(),
                psk=await self._gw.preshared_key(), private_key=secret["private_key"], public_key=c.public_key,
                address=c.address, endpoint_host=st["endpoint_host"] or self._default_host, dns=st["client_dns"])
            c.config_downloaded_at = utcnow()
            if actor:
                self._audit.record(s, actor, "client.config_viewed", "client", c.id, c.name)
        return bundle

    async def create_share_link(self, actor: Actor, client_id: uuid.UUID, hours: int | None = None) -> dict:
        hours = hours or await self._settings.get("share_link_hours")
        token = secrets.token_urlsafe(24)
        async with self._db.session() as s:
            c = await ClientRepo(s).require(client_id)
            if not c.managed:
                raise DomainError("Сначала перевыпустите ключи клиента")
            expires = utcnow() + dt.timedelta(hours=hours)
            ShareRepo(s).add(ShareLink(token_hash=hashlib.sha256(token.encode()).hexdigest(), client_id=c.id,
                                       created_by=actor.username, expires_at=expires, uses_left=3))
            self._audit.record(s, actor, "client.share_link_created", "client", c.id, c.name, hours=hours)
        return {"url": f"{self._public_base}/s/{token}", "expires_at": expires.isoformat()}

    async def consume_share_link(self, token: str, ip: str) -> ClientBundle:
        async with self._db.session() as s:
            link = await ShareRepo(s).get(hashlib.sha256(token.encode()).hexdigest())
            if not link or link.expires_at < utcnow() or link.uses_left <= 0:
                raise NotFound("Ссылка недействительна или истекла")
            link.uses_left -= 1
            client_id = link.client_id
            c = await ClientRepo(s).require(client_id)
            self._audit.record(s, Actor("share-link", "", ip), "client.share_link_used", "client", c.id, c.name)
        return await self.bundle(None, client_id)


    async def sync(self, actor: Actor | None = None) -> dict:
        cfg = await self._editor.load()
        table = {t.get("clientId"): t.get("userData", {}) for t in await self._gw.read_clients_table()}
        peers = {p.public_key: p for p in cfg.peers if p.public_key}
        imported, missing = 0, 0
        async with self._db.session() as s:
            repo = ClientRepo(s)
            known = {c.public_key: c for c in await repo.all()}
            for pub, p in peers.items():
                c = known.get(pub)
                if c is None:
                    ud = table.get(pub, {})
                    c = repo.add(VpnClient(public_key=pub, name=ud.get("clientName") or pub[:10], address=p.address,
                                           managed=False, created_by="import"))
                    imported += 1
                c.address = p.address
                if p.disabled and c.status != ClientStatus.BLOCKED:
                    c.status, c.block_reason = ClientStatus.BLOCKED, c.block_reason or BlockReason.MANUAL
                elif not p.disabled and c.status != ClientStatus.ACTIVE:
                    c.status, c.block_reason = ClientStatus.ACTIVE, None
            for pub, c in known.items():
                if pub not in peers and c.status != ClientStatus.MISSING:
                    c.status = ClientStatus.MISSING
                    missing += 1
            if actor and (imported or missing):
                self._audit.record(s, actor, "client.sync", "server", "", "", imported=imported, missing=missing)
        if imported or missing:
            self._bus.publish("clients", {"sync": True})
        return {"imported": imported, "missing": missing, "peers": len(peers)}


    async def _table_upsert(self, pub: str, name: str, address: str) -> None:
        table = await self._gw.read_clients_table()
        for t in table:
            if t.get("clientId") == pub:
                t.setdefault("userData", {})["clientName"] = name
                break
        else:
            table.append({"clientId": pub, "userData": {
                "clientName": name, "allowedIps": address, "allowed_ips": address,
                "creationDate": dt.datetime.now().strftime("%a %b %d %H:%M:%S %Y")}})
        await self._gw.write_clients_table(table)

    async def _table_remove(self, pub: str) -> None:
        await self._gw.write_clients_table([t for t in await self._gw.read_clients_table() if t.get("clientId") != pub])

    async def _table_rekey(self, old: str, new: str, name: str) -> None:
        table = await self._gw.read_clients_table()
        for t in table:
            if t.get("clientId") == old:
                t["clientId"] = new
        await self._gw.write_clients_table(table)

    @staticmethod
    def _tags(tags) -> list[str]:
        return sorted({t.strip()[:32] for t in (tags or []) if t and t.strip()})
