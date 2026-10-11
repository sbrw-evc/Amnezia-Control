from ..db.base import Database
from ..db.repositories import ClientRepo
from ..domain.models import Severity
from ..ports import SecretStore
from .alerts import AlertService
from .common import utcnow
from .settings import SettingsService


class HealthMonitor:
    def __init__(self, db: Database, secrets_store: SecretStore, alerts: AlertService, settings: SettingsService):
        self._db = db
        self._secrets = secrets_store
        self._alerts = alerts
        self._settings = settings

    async def run(self) -> None:
        if await self._secrets.healthy():
            await self._alerts.resolve("openbao.down")
        else:
            await self._alerts.raise_("openbao.down", Severity.CRITICAL, "OpenBao недоступен или запечатан",
                                      "Выдача конфигов и создание клиентов невозможны")
        stale = await self._settings.get("gateway_stale_minutes")
        async with self._db.session() as s:
            gateways = [c for c in await ClientRepo(s).all() if c.system]
        for g in gateways:
            age = (utcnow() - g.last_handshake_at).total_seconds() / 60 if g.last_handshake_at else None
            key = f"gateway.stale.{g.id}"
            if age is None or age > stale:
                await self._alerts.raise_(key, Severity.CRITICAL, f"Домашний шлюз не на связи: {g.name}",
                                          "Нет handshake с сервером" + (f" {int(age)} мин" if age else ""), str(g.id))
            else:
                await self._alerts.resolve(key)
