import datetime as dt
import hashlib
import secrets

from ..db.base import Database
from ..db.models import ApiToken
from ..db.repositories import ApiTokenRepo
from ..domain.errors import DomainError, Unauthorized
from ..domain.models import Role
from .audit import AuditService
from .common import Actor, utcnow

PREFIX = "ac_"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_dto(t: ApiToken) -> dict:
    return {"id": t.id, "name": t.name, "prefix": t.prefix, "role": t.role.value, "created_by": t.created_by,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "expires_at": t.expires_at.isoformat() if t.expires_at else None,
            "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None}


class ApiTokenService:
    def __init__(self, db: Database, audit: AuditService):
        self._db = db
        self._audit = audit

    async def list(self) -> list[dict]:
        async with self._db.session() as s:
            return [token_dto(t) for t in await ApiTokenRepo(s).all(order_by=ApiToken.id)]

    async def create(self, actor: Actor, name: str, role: Role, days: int | None) -> dict:
        name = name.strip()[:128]
        if not name:
            raise DomainError("Укажите название токена")
        raw = PREFIX + secrets.token_urlsafe(32)
        async with self._db.session() as s:
            t = ApiTokenRepo(s).add(ApiToken(
                name=name, token_hash=_hash(raw), prefix=raw[:10], role=role, created_by=actor.username,
                expires_at=utcnow() + dt.timedelta(days=days) if days else None))
            await s.flush()
            self._audit.record(s, actor, "api_token.created", "api_token", t.id, name, role=role.value)
            return {**token_dto(t), "token": raw}

    async def revoke(self, actor: Actor, token_id: int) -> None:
        async with self._db.session() as s:
            repo = ApiTokenRepo(s)
            t = await repo.require(token_id)
            self._audit.record(s, actor, "api_token.revoked", "api_token", t.id, t.name)
            await repo.remove(t)

    async def authenticate(self, raw: str) -> ApiToken:
        if not raw.startswith(PREFIX):
            raise Unauthorized("Неверный токен")
        async with self._db.session() as s:
            t = await ApiTokenRepo(s).by_hash(_hash(raw))
            now = utcnow()
            if not t or (t.expires_at and t.expires_at < now):
                raise Unauthorized("Токен недействителен или истёк")
            if not t.last_used_at or (now - t.last_used_at).total_seconds() > 60:
                t.last_used_at = now
            return t
