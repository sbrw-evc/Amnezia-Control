from __future__ import annotations

import datetime as dt
import uuid
from typing import Generic, Sequence, TypeVar

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.errors import NotFound
from .models import (Alert, ApiToken, AuditEntry, Base, ConnectionEvent, PanelSession, PanelUser, SavedFilter,
                     SettingRow, ShareLink,
                     TrafficBucket, VpnClient)

T = TypeVar("T", bound=Base)


class Repository(Generic[T]):
    model: type[T]
    label = "Object"

    def __init__(self, session: AsyncSession):
        self.s = session

    async def get(self, key) -> T | None:
        return await self.s.get(self.model, key)

    async def require(self, key) -> T:
        obj = await self.get(key)
        if obj is None:
            raise NotFound(f"{self.label} not found")
        return obj

    async def all(self, *where, order_by=None, limit: int | None = None) -> Sequence[T]:
        q = select(self.model).where(*where)
        if order_by is not None:
            q = q.order_by(order_by)
        if limit:
            q = q.limit(limit)
        return (await self.s.execute(q)).scalars().all()

    def add(self, obj: T) -> T:
        self.s.add(obj)
        return obj

    async def remove(self, obj: T) -> None:
        await self.s.delete(obj)


class UserRepo(Repository[PanelUser]):
    model = PanelUser
    label = "Panel user"

    async def by_username(self, username: str) -> PanelUser | None:
        return (await self.s.execute(select(PanelUser).where(func.lower(PanelUser.username) == username.lower()))).scalar_one_or_none()

    async def count(self) -> int:
        return (await self.s.execute(select(func.count()).select_from(PanelUser))).scalar_one()

    async def count_admins(self) -> int:
        return (await self.s.execute(select(func.count()).where(PanelUser.role == "admin", PanelUser.is_active))).scalar_one()

    async def by_external(self, source: str, external_id: str) -> PanelUser | None:
        q = select(PanelUser).where(PanelUser.source == source, PanelUser.external_id == external_id)
        return (await self.s.execute(q)).scalar_one_or_none()


class SessionRepo(Repository[PanelSession]):
    model = PanelSession

    async def for_user(self, user_id: int) -> Sequence[PanelSession]:
        return await self.all(PanelSession.user_id == user_id, PanelSession.expires_at > func.now(),
                              order_by=PanelSession.last_seen_at.desc())

    async def revoke_user(self, user_id: int, keep: str | None = None) -> None:
        q = delete(PanelSession).where(PanelSession.user_id == user_id)
        if keep:
            q = q.where(PanelSession.token_hash != keep)
        await self.s.execute(q)

    async def purge_expired(self) -> None:
        await self.s.execute(delete(PanelSession).where(PanelSession.expires_at < func.now()))


class ClientRepo(Repository[VpnClient]):
    model = VpnClient
    label = "VPN client"

    async def by_public_key(self, pub: str) -> VpnClient | None:
        return (await self.s.execute(select(VpnClient).where(VpnClient.public_key == pub))).scalar_one_or_none()

    async def search(self, q: str | None = None, status: str | None = None, tag: str | None = None,
                     server: str | None = None) -> Sequence[VpnClient]:
        where = []
        if q:
            like = f"%{q.lower()}%"
            where.append(or_(func.lower(VpnClient.name).like(like), func.lower(VpnClient.owner).like(like),
                             VpnClient.address.like(like), VpnClient.public_key.like(f"%{q}%")))
        if status:
            where.append(VpnClient.status == status)
        if tag:
            where.append(VpnClient.tags.any(tag))
        if server:
            where.append(VpnClient.server == server)
        return await self.all(*where, order_by=VpnClient.created_at)

    async def all_tags(self) -> list[str]:
        rows = await self.s.execute(select(func.unnest(VpnClient.tags)).distinct())
        return sorted(r[0] for r in rows)


class TrafficRepo:
    BUCKET_SECONDS = 300

    def __init__(self, session: AsyncSession):
        self.s = session

    async def add(self, client_id: uuid.UUID, at: dt.datetime, rx: int, tx: int) -> None:
        epoch = int(at.timestamp())
        bucket = dt.datetime.fromtimestamp(epoch - epoch % self.BUCKET_SECONDS, dt.timezone.utc)
        stmt = insert(TrafficBucket).values(client_id=client_id, bucket=bucket, rx=rx, tx=tx)
        stmt = stmt.on_conflict_do_update(index_elements=["client_id", "bucket"],
                                          set_={"rx": TrafficBucket.rx + rx, "tx": TrafficBucket.tx + tx})
        await self.s.execute(stmt)

    async def series(self, since: dt.datetime, step: dt.timedelta, client_id: uuid.UUID | None = None) -> list[dict]:
        sql = ("SELECT date_bin(:step, bucket, TIMESTAMPTZ '2000-01-01') AS ts, "
               "SUM(rx) AS rx, SUM(tx) AS tx FROM traffic_buckets WHERE bucket >= :since "
               + ("AND client_id = :cid " if client_id else "") + "GROUP BY ts ORDER BY ts")
        params = {"step": step, "since": since}
        if client_id:
            params["cid"] = client_id
        rows = await self.s.execute(text(sql), params)
        return [{"t": r.ts.isoformat(), "rx": int(r.rx), "tx": int(r.tx)} for r in rows]

    async def totals_by_client(self, since: dt.datetime) -> dict[uuid.UUID, tuple[int, int]]:
        rows = await self.s.execute(select(TrafficBucket.client_id, func.sum(TrafficBucket.rx), func.sum(TrafficBucket.tx))
                                    .where(TrafficBucket.bucket >= since).group_by(TrafficBucket.client_id))
        return {r[0]: (int(r[1]), int(r[2])) for r in rows}

    async def total(self, since: dt.datetime) -> tuple[int, int]:
        r = (await self.s.execute(select(func.coalesce(func.sum(TrafficBucket.rx), 0), func.coalesce(func.sum(TrafficBucket.tx), 0))
                                  .where(TrafficBucket.bucket >= since))).one()
        return int(r[0]), int(r[1])

    async def heatmap(self, since: dt.datetime, tz: str) -> list[dict]:
        rows = await self.s.execute(text(
            "SELECT EXTRACT(ISODOW FROM bucket AT TIME ZONE :tz)::int AS dow, "
            "EXTRACT(HOUR FROM bucket AT TIME ZONE :tz)::int AS hour, SUM(rx + tx) AS bytes "
            "FROM traffic_buckets WHERE bucket >= :since GROUP BY dow, hour"), {"since": since, "tz": tz})
        return [{"dow": r.dow, "hour": r.hour, "bytes": int(r.bytes)} for r in rows]

    async def purge(self, before: dt.datetime) -> None:
        await self.s.execute(delete(TrafficBucket).where(TrafficBucket.bucket < before))


class ConnectionRepo(Repository[ConnectionEvent]):
    model = ConnectionEvent

    async def for_client(self, client_id: uuid.UUID, limit: int = 100) -> Sequence[ConnectionEvent]:
        return await self.all(ConnectionEvent.client_id == client_id, order_by=ConnectionEvent.ts.desc(), limit=limit)

    async def fill_geo(self, client_id: uuid.UUID, ip: str, geo) -> None:
        await self.s.execute(update(ConnectionEvent)
                             .where(ConnectionEvent.client_id == client_id, ConnectionEvent.ip == ip,
                                    ConnectionEvent.lat.is_(None))
                             .values(country_code=geo.country_code, country=geo.country, city=geo.city,
                                     lat=geo.lat, lon=geo.lon))

    async def recent(self, limit: int = 50) -> Sequence[ConnectionEvent]:
        return await self.all(order_by=ConnectionEvent.ts.desc(), limit=limit)

    async def by_country(self, since: dt.datetime) -> list[dict]:
        rows = await self.s.execute(
            select(ConnectionEvent.country_code, ConnectionEvent.country, func.count(),
                   func.count(func.distinct(ConnectionEvent.client_id)))
            .where(ConnectionEvent.ts >= since, ConnectionEvent.country_code.isnot(None))
            .group_by(ConnectionEvent.country_code, ConnectionEvent.country).order_by(func.count().desc()))
        return [{"code": r[0], "country": r[1], "connections": r[2], "clients": r[3]} for r in rows]

    async def points(self, since: dt.datetime) -> list[dict]:
        rows = await self.s.execute(
            select(ConnectionEvent.lat, ConnectionEvent.lon, ConnectionEvent.city, ConnectionEvent.country,
                   func.count(), func.array_agg(func.distinct(ConnectionEvent.client_id)))
            .where(ConnectionEvent.ts >= since, ConnectionEvent.lat.isnot(None))
            .group_by(ConnectionEvent.lat, ConnectionEvent.lon, ConnectionEvent.city, ConnectionEvent.country))
        return [{"lat": r[0], "lon": r[1], "city": r[2], "country": r[3], "connections": r[4],
                 "client_ids": [str(c) for c in r[5]]} for r in rows]

    async def purge(self, before: dt.datetime) -> None:
        await self.s.execute(delete(ConnectionEvent).where(ConnectionEvent.ts < before))


class AuditRepo(Repository[AuditEntry]):
    model = AuditEntry

    async def page(self, limit: int, offset: int, action: str | None, actor: str | None, q: str | None):
        where = []
        if action:
            where.append(AuditEntry.action.like(f"{action}%"))
        if actor:
            where.append(AuditEntry.actor == actor)
        if q:
            where.append(or_(AuditEntry.target_name.ilike(f"%{q}%"), AuditEntry.action.ilike(f"%{q}%")))
        total = (await self.s.execute(select(func.count()).select_from(AuditEntry).where(*where))).scalar_one()
        rows = (await self.s.execute(select(AuditEntry).where(*where).order_by(AuditEntry.ts.desc())
                                     .limit(limit).offset(offset))).scalars().all()
        return total, rows


class AlertRepo(Repository[Alert]):
    model = Alert

    async def open_by_key(self, key: str) -> Alert | None:
        return (await self.s.execute(select(Alert).where(Alert.key == key, Alert.resolved_at.is_(None)))).scalar_one_or_none()

    async def open(self) -> Sequence[Alert]:
        return await self.all(Alert.resolved_at.is_(None), order_by=Alert.ts.desc())

    async def history(self, limit: int = 200) -> Sequence[Alert]:
        return await self.all(order_by=Alert.ts.desc(), limit=limit)

    async def open_count(self) -> dict[str, int]:
        rows = await self.s.execute(select(Alert.severity, func.count()).where(Alert.resolved_at.is_(None))
                                    .group_by(Alert.severity))
        return {r[0].value if hasattr(r[0], "value") else r[0]: r[1] for r in rows}


class ShareRepo(Repository[ShareLink]):
    model = ShareLink
    label = "Link"


class ApiTokenRepo(Repository[ApiToken]):
    model = ApiToken
    label = "Token"

    async def by_hash(self, token_hash: str) -> ApiToken | None:
        return (await self.s.execute(select(ApiToken).where(ApiToken.token_hash == token_hash))).scalar_one_or_none()

    async def revoke_user(self, user_id: int) -> int:
        return (await self.s.execute(delete(ApiToken).where(ApiToken.user_id == user_id))).rowcount or 0


class SavedFilterRepo(Repository[SavedFilter]):
    model = SavedFilter
    label = "Filter"

    async def visible(self, username: str) -> Sequence[SavedFilter]:
        return await self.all(or_(SavedFilter.shared, SavedFilter.created_by == username), order_by=SavedFilter.name)


class SettingRepo:
    def __init__(self, session: AsyncSession):
        self.s = session

    async def get_all(self) -> dict:
        rows = (await self.s.execute(select(SettingRow))).scalars().all()
        return {r.key: r.value.get("v") for r in rows}

    async def put(self, key: str, value) -> None:
        stmt = insert(SettingRow).values(key=key, value={"v": value})
        await self.s.execute(stmt.on_conflict_do_update(index_elements=["key"], set_={"value": {"v": value}}))
