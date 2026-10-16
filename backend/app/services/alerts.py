from ..db.base import Database
from ..db.models import Alert
from ..db.repositories import AlertRepo
from ..domain.errors import NotFound
from ..domain.models import Severity
from .common import Actor, EventBus, utcnow


class AlertService:
    def __init__(self, db: Database, bus: EventBus):
        self._db = db
        self._bus = bus
        self.notifications = None

    async def raise_(self, key: str, severity: Severity, title: str, message: str = "", target_id: str = "") -> None:
        async with self._db.session() as s:
            repo = AlertRepo(s)
            existing = await repo.open_by_key(key)
            if existing:
                if existing.severity != severity or existing.message != message:
                    existing.severity, existing.message, existing.title = severity, message, title
                return
            repo.add(Alert(key=key, severity=severity, title=title, message=message, target_id=target_id))
        self._bus.publish("alert", {"key": key, "severity": severity.value, "title": title})
        if self.notifications:
            await self.notifications.alert_raised(severity, title, message)

    async def resolve(self, key: str) -> None:
        resolved = None
        async with self._db.session() as s:
            a = await AlertRepo(s).open_by_key(key)
            if a:
                a.resolved_at = utcnow()
                resolved = (a.severity, a.title)
                self._bus.publish("alert", {"key": key, "resolved": True})
        if resolved and self.notifications:
            await self.notifications.alert_resolved(*resolved)

    async def resolve_prefix_except(self, prefix: str, keep: set[str]) -> None:
        async with self._db.session() as s:
            for a in await AlertRepo(s).open():
                if a.key.startswith(prefix) and a.key not in keep:
                    a.resolved_at = utcnow()

    async def acknowledge(self, alert_id: int, actor: Actor) -> None:
        async with self._db.session() as s:
            a = await AlertRepo(s).get(alert_id)
            if not a:
                raise NotFound("Алерт не найден")
            a.acknowledged_by = actor.username

    async def list(self, include_resolved: bool = False) -> list[dict]:
        async with self._db.session() as s:
            repo = AlertRepo(s)
            rows = await (repo.history() if include_resolved else repo.open())
        return [{"id": a.id, "key": a.key, "ts": a.ts.isoformat(), "severity": a.severity.value, "title": a.title,
                 "message": a.message, "target_id": a.target_id, "acknowledged_by": a.acknowledged_by,
                 "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None} for a in rows]

    async def counts(self) -> dict:
        async with self._db.session() as s:
            return await AlertRepo(s).open_count()
