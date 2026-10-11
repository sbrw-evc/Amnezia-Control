from sqlalchemy.ext.asyncio import AsyncSession

from ..db.base import Database
from ..db.models import AuditEntry
from ..db.repositories import AuditRepo
from .common import Actor, EventBus


class AuditService:
    def __init__(self, db: Database, bus: EventBus):
        self._db = db
        self._bus = bus

    def record(self, s: AsyncSession, actor: Actor, action: str, target_type: str = "", target_id: str = "",
               target_name: str = "", **details) -> None:
        AuditRepo(s).add(AuditEntry(actor=actor.username, action=action, target_type=target_type,
                                    target_id=str(target_id), target_name=target_name, details=details, ip=actor.ip))
        self._bus.publish("audit", {"action": action, "actor": actor.username, "target": target_name})

    async def page(self, limit=50, offset=0, action=None, actor=None, q=None):
        async with self._db.session() as s:
            total, rows = await AuditRepo(s).page(limit, offset, action, actor, q)
        return {"total": total, "items": [{
            "id": r.id, "ts": r.ts.isoformat(), "actor": r.actor, "action": r.action, "target_type": r.target_type,
            "target_id": r.target_id, "target_name": r.target_name, "details": r.details, "ip": r.ip} for r in rows]}
