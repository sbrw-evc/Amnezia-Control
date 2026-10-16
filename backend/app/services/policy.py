import datetime as dt
import logging
from zoneinfo import ZoneInfo

from ..db.base import Database
from ..db.repositories import ClientRepo, TrafficRepo
from ..domain.errors import DomainError
from ..domain.models import BlockReason, ClientStatus, Severity
from .alerts import AlertService
from .clients import VpnClientService, month_start
from .common import Actor, utcnow
from .settings import SettingsService

log = logging.getLogger(__name__)


class PolicyEnforcer:
    def __init__(self, db: Database, clients: VpnClientService, alerts: AlertService, settings: SettingsService):
        self._db = db
        self._clients = clients
        self._alerts = alerts
        self._settings = settings

    async def run(self) -> None:
        st = await self._settings.all()
        now = utcnow()
        async with self._db.session() as s:
            clients = [c for c in await ClientRepo(s).all() if not c.system and c.status != ClientStatus.MISSING]
            usage = await TrafficRepo(s).totals_by_client(month_start(now))
        warn_keys: set[str] = set()
        for c in clients:
            used = sum(usage.get(c.id, (0, 0)))
            expired = c.expires_at is not None and c.expires_at <= now
            over = c.quota_bytes is not None and used >= c.quota_bytes
            try:
                if c.status == ClientStatus.ACTIVE and expired:
                    await self._clients.set_blocked(Actor.system(), c.id, True, BlockReason.EXPIRED)
                    await self._alerts.raise_(f"client.expired.{c.id}", Severity.INFO, f"Срок доступа истёк: {c.name}",
                                              "Клиент автоматически заблокирован", str(c.id))
                elif c.status == ClientStatus.ACTIVE and over:
                    await self._clients.set_blocked(Actor.system(), c.id, True, BlockReason.QUOTA)
                    await self._alerts.raise_(f"client.quota.{c.id}", Severity.WARNING, f"Квота исчерпана: {c.name}",
                                              "Клиент заблокирован до начала следующего месяца", str(c.id))
                elif c.status == ClientStatus.BLOCKED and c.block_reason == BlockReason.QUOTA and not over and not expired:
                    await self._clients.set_blocked(Actor.system(), c.id, False)
                    await self._alerts.resolve(f"client.quota.{c.id}")
                elif c.status == ClientStatus.BLOCKED and c.block_reason == BlockReason.EXPIRED and not expired:
                    await self._clients.set_blocked(Actor.system(), c.id, False)
                    await self._alerts.resolve(f"client.expired.{c.id}")
            except DomainError as e:
                log.warning("policy for %s failed: %s", c.name, e.message)
                continue
            if c.status == ClientStatus.ACTIVE:
                if c.quota_bytes and not over and used * 100 >= c.quota_bytes * st["quota_warn_percent"]:
                    key = f"client.quota_warn.{c.id}"
                    warn_keys.add(key)
                    await self._alerts.raise_(key, Severity.WARNING, f"Квота почти исчерпана: {c.name}",
                                              f"Использовано {used * 100 // c.quota_bytes}% месячной квоты", str(c.id))
                if c.expires_at and not expired and c.expires_at - now <= dt.timedelta(days=st["expiry_warn_days"]):
                    key = f"client.expiring.{c.id}"
                    warn_keys.add(key)
                    await self._alerts.raise_(key, Severity.INFO, f"Скоро истекает доступ: {c.name}",
                                              f"До {c.expires_at.astimezone(ZoneInfo(st['timezone'])).strftime('%d.%m.%Y %H:%M')}",
                                              str(c.id))
        await self._alerts.resolve_prefix_except("client.quota_warn.", warn_keys)
        await self._alerts.resolve_prefix_except("client.expiring.", warn_keys)
