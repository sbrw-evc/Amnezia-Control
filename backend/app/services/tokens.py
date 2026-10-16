import datetime as dt
import hashlib
import secrets
from dataclasses import dataclass

from ..db.base import Database
from ..db.models import ApiToken, PanelUser
from ..db.repositories import ApiTokenRepo, UserRepo
from ..domain.errors import DomainError, Unauthorized
from ..domain.models import Role
from .audit import AuditService
from .common import Actor, utcnow

PREFIX = "ac_"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class TokenAuth:
    token: ApiToken
    owner: PanelUser
    role: Role


def token_dto(t: ApiToken) -> dict:
    return {"id": t.id, "name": t.name, "prefix": t.prefix, "role": t.role.value, "created_by": t.created_by,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "expires_at": t.expires_at.isoformat() if t.expires_at else None,
            "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None}


class ApiTokenService:
    """API tokens for machines (scripts, integrations). Each token belongs to the person who issued it: it works only
    while that person is enabled in SPA, never with more rights than their current role, and it is revoked when SPA
    disables them (services/identity/spa.py)."""

    def __init__(self, db: Database, audit: AuditService):
        self._db = db
        self._audit = audit

    async def list(self) -> list[dict]:
        async with self._db.session() as s:
            return [token_dto(t) for t in await ApiTokenRepo(s).all(order_by=ApiToken.id)]

    async def create(self, actor: Actor, owner_id: int, name: str, role: Role, days: int | None) -> dict:
        name = name.strip()[:128]
        if not name:
            raise DomainError("Enter a token name")
        raw = PREFIX + secrets.token_urlsafe(32)
        async with self._db.session() as s:
            owner = await UserRepo(s).require(owner_id)
            if not owner.role.allows(role):
                raise DomainError("A token cannot have more rights than its owner")
            t = ApiTokenRepo(s).add(ApiToken(
                name=name, token_hash=_hash(raw), prefix=raw[:10], role=role, created_by=actor.username, user_id=owner.id,
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

    async def authenticate(self, raw: str) -> TokenAuth:
        if not raw.startswith(PREFIX):
            raise Unauthorized("Invalid token")
        async with self._db.session() as s:
            t = await ApiTokenRepo(s).by_hash(_hash(raw))
            now = utcnow()
            if not t or (t.expires_at and t.expires_at < now):
                raise Unauthorized("The token is invalid or has expired")
            owner = await UserRepo(s).get(t.user_id) if t.user_id else None
            if not owner or not owner.is_active:
                raise Unauthorized("The owner of the token is disabled in SPA")
            if not t.last_used_at or (now - t.last_used_at).total_seconds() > 60:
                t.last_used_at = now
            role = t.role if owner.role.allows(t.role) else owner.role
            return TokenAuth(t, owner, role)
