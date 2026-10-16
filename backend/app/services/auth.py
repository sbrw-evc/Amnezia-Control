"""Sessions of Network Control. People sign in through SPA (services/identity/spa.py); after the SPA callback the
application starts its own session (an opaque token in an HttpOnly cookie, kept as a SHA-256 hash)."""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets

from ..db.base import Database
from ..db.models import PanelSession, PanelUser
from ..db.repositories import SessionRepo, UserRepo
from ..domain.errors import Unauthorized
from .audit import AuditService
from .common import Actor, utcnow


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AuthService:
    def __init__(self, db: Database, audit: AuditService, ttl_hours: int):
        self._db = db
        self._audit = audit
        self._ttl = dt.timedelta(hours=ttl_hours)

    async def start_session(self, user_id: int, ip: str, user_agent: str, **audit) -> str:
        token = secrets.token_urlsafe(32)
        async with self._db.session() as s:
            user = await UserRepo(s).require(user_id)
            now = utcnow()
            SessionRepo(s).add(PanelSession(token_hash=hash_token(token), user_id=user.id, expires_at=now + self._ttl,
                                            ip=ip, user_agent=user_agent[:256]))
            user.last_login_at = now
            self._audit.record(s, Actor(user.username, user.role.value, ip), "auth.login", **audit)
        return token

    async def authenticate(self, token: str | None) -> tuple[PanelUser, PanelSession]:
        if not token:
            raise Unauthorized("Sign-in required")
        async with self._db.session() as s:
            sess = await SessionRepo(s).get(hash_token(token))
            now = utcnow()
            if not sess or sess.expires_at < now:
                raise Unauthorized("The session has expired")
            user = await UserRepo(s).get(sess.user_id)
            if not user or not user.is_active:
                raise Unauthorized("The account is disabled")
            if (now - sess.last_seen_at).total_seconds() > 60:
                sess.last_seen_at = now
            return user, sess

    async def logout(self, token: str, ip: str = "") -> None:
        async with self._db.session() as s:
            sess = await SessionRepo(s).get(hash_token(token))
            if sess:
                user = await UserRepo(s).get(sess.user_id)
                if user:
                    self._audit.record(s, Actor(user.username, user.role.value, ip), "auth.logout")
                await s.delete(sess)

    async def sessions(self, user_id: int, current_token: str) -> list[dict]:
        cur = hash_token(current_token)
        async with self._db.session() as s:
            rows = await SessionRepo(s).for_user(user_id)
        return [{"id": r.token_hash[:16], "created_at": r.created_at.isoformat(), "last_seen_at": r.last_seen_at.isoformat(),
                 "ip": r.ip, "user_agent": r.user_agent, "current": r.token_hash == cur} for r in rows]

    async def revoke_session(self, user_id: int, session_prefix: str) -> None:
        async with self._db.session() as s:
            for r in await SessionRepo(s).for_user(user_id):
                if r.token_hash.startswith(session_prefix):
                    await s.delete(r)
