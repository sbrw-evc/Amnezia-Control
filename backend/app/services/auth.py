from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import io
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass

import pyotp
import qrcode
import qrcode.image.svg
from argon2 import PasswordHasher as _Argon2
from argon2.exceptions import VerifyMismatchError, InvalidHashError

from ..db.base import Database
from ..db.models import PanelSession, PanelUser
from ..db.repositories import SessionRepo, UserRepo
from ..domain.errors import DomainError, Unauthorized
from ..ports import SecretStore
from .audit import AuditService
from .common import Actor, utcnow

MAX_FAILURES = 5
LOCK_MINUTES = 10
MIN_PASSWORD = 10


class PasswordHasher:
    def __init__(self):
        self._h = _Argon2()

    def hash(self, password: str) -> str:
        return self._h.hash(password)

    def verify(self, hashed: str, password: str) -> bool:
        try:
            return self._h.verify(hashed, password)
        except (VerifyMismatchError, InvalidHashError):
            return False

    async def ahash(self, password: str) -> str:
        return await asyncio.to_thread(self.hash, password)

    async def averify(self, hashed: str, password: str) -> bool:
        return await asyncio.to_thread(self.verify, hashed, password)

    @staticmethod
    def validate_strength(password: str) -> None:
        if len(password) < MIN_PASSWORD:
            raise DomainError(f"Пароль должен быть не короче {MIN_PASSWORD} символов")
        classes = sum(any(f(c) for c in password) for f in (str.islower, str.isupper, str.isdigit))
        if classes < 2:
            raise DomainError("Пароль должен содержать буквы разного регистра или цифры")


class IpRateLimiter:
    def __init__(self, limit: int = 10, window: int = 300):
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._limit, self._window = limit, window

    def check(self, ip: str) -> None:
        now = time.monotonic()
        hits = [t for t in self._hits[ip] if now - t < self._window]
        self._hits[ip] = hits
        if len(hits) >= self._limit:
            raise DomainError("Слишком много попыток входа. Подождите несколько минут.")
        hits.append(now)


@dataclass
class LoginResult:
    token: str
    user: PanelUser
    requires_2fa: bool


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AuthService:
    def __init__(self, db: Database, secrets_store: SecretStore, audit: AuditService, ttl_hours: int):
        self._db = db
        self._secrets = secrets_store
        self._audit = audit
        self._ttl = dt.timedelta(hours=ttl_hours)
        self.hasher = PasswordHasher()
        self._limiter = IpRateLimiter()

    @staticmethod
    def _totp_path(user_id: int, pending: bool = False) -> str:
        return f"users/{user_id}/totp" + ("_pending" if pending else "")

    async def ensure_initial_admin(self, username: str, password: str) -> None:
        async with self._db.session() as s:
            repo = UserRepo(s)
            if await repo.count() or not password:
                return
            repo.add(PanelUser(username=username, display_name="Администратор", role="admin",
                               password_hash=await self.hasher.ahash(password), must_change_password=True))

    async def login(self, username: str, password: str, ip: str, user_agent: str) -> LoginResult:
        self._limiter.check(ip)
        failure: str | None = None
        async with self._db.session() as s:
            user = await UserRepo(s).by_username(username.strip())
            now = utcnow()
            if user and user.locked_until and user.locked_until > now:
                failure = "Учётная запись временно заблокирована после неудачных попыток входа"
            elif not user or not user.is_active or not await self.hasher.averify(user.password_hash, password):
                if user:
                    user.failed_attempts += 1
                    if user.failed_attempts >= MAX_FAILURES:
                        user.locked_until = now + dt.timedelta(minutes=LOCK_MINUTES)
                        user.failed_attempts = 0
                failure = "Неверный логин или пароль"
            if failure:
                self._audit.record(s, Actor(username.strip()[:64] or "?", "", ip), "auth.login_failed")
        if failure:
            raise Unauthorized(failure)
        async with self._db.session() as s:
            user = await UserRepo(s).require(user.id)
            user.failed_attempts = 0
            token = secrets.token_urlsafe(32)
            SessionRepo(s).add(PanelSession(token_hash=_hash_token(token), user_id=user.id, expires_at=now + self._ttl,
                                            ip=ip, user_agent=user_agent[:256], pending_2fa=user.totp_enabled))
            if not user.totp_enabled:
                user.last_login_at = now
                self._audit.record(s, Actor(user.username, user.role.value, ip), "auth.login")
            return LoginResult(token, user, user.totp_enabled)

    async def verify_2fa(self, token: str, code: str, ip: str) -> PanelUser:
        async with self._db.session() as s:
            sess = await SessionRepo(s).get(_hash_token(token))
            if not sess or not sess.pending_2fa or sess.expires_at < utcnow():
                raise Unauthorized("Сессия входа истекла, войдите заново")
            user = await UserRepo(s).require(sess.user_id)
            secret = await self._secrets.get(self._totp_path(user.id))
            if not secret or not pyotp.TOTP(secret["secret"]).verify(code.strip(), valid_window=1):
                self._limiter.check(ip)
                raise Unauthorized("Неверный код")
            sess.pending_2fa = False
            user.last_login_at = utcnow()
            self._audit.record(s, Actor(user.username, user.role.value, ip), "auth.login", method="totp")
            return user

    async def authenticate(self, token: str | None) -> tuple[PanelUser, PanelSession]:
        if not token:
            raise Unauthorized("Требуется вход")
        async with self._db.session() as s:
            sess = await SessionRepo(s).get(_hash_token(token))
            now = utcnow()
            if not sess or sess.expires_at < now or sess.pending_2fa:
                raise Unauthorized("Сессия истекла")
            user = await UserRepo(s).get(sess.user_id)
            if not user or not user.is_active:
                raise Unauthorized("Учётная запись отключена")
            if (now - sess.last_seen_at).total_seconds() > 60:
                sess.last_seen_at = now
            return user, sess

    async def logout(self, token: str) -> None:
        async with self._db.session() as s:
            sess = await SessionRepo(s).get(_hash_token(token))
            if sess:
                await s.delete(sess)

    async def change_password(self, user_id: int, current: str, new: str, current_token: str) -> None:
        self.hasher.validate_strength(new)
        async with self._db.session() as s:
            user = await UserRepo(s).require(user_id)
            if not await self.hasher.averify(user.password_hash, current):
                raise DomainError("Текущий пароль указан неверно")
            if current == new:
                raise DomainError("Новый пароль совпадает с текущим")
            user.password_hash = await self.hasher.ahash(new)
            user.must_change_password = False
            await SessionRepo(s).revoke_user(user.id, keep=_hash_token(current_token))
            self._audit.record(s, Actor(user.username, user.role.value), "auth.password_changed")

    async def sessions(self, user_id: int, current_token: str) -> list[dict]:
        cur = _hash_token(current_token)
        async with self._db.session() as s:
            rows = await SessionRepo(s).for_user(user_id)
        return [{"id": r.token_hash[:16], "created_at": r.created_at.isoformat(), "last_seen_at": r.last_seen_at.isoformat(),
                 "ip": r.ip, "user_agent": r.user_agent, "current": r.token_hash == cur} for r in rows if not r.pending_2fa]

    async def revoke_session(self, user_id: int, session_prefix: str) -> None:
        async with self._db.session() as s:
            for r in await SessionRepo(s).for_user(user_id):
                if r.token_hash.startswith(session_prefix):
                    await s.delete(r)


    async def totp_begin(self, user: PanelUser) -> dict:
        secret = pyotp.random_base32()
        await self._secrets.put(self._totp_path(user.id, pending=True), {"secret": secret})
        uri = pyotp.TOTP(secret).provisioning_uri(name=user.username, issuer_name="Network Control")

        def render() -> str:
            buf = io.BytesIO()
            qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2).save(buf)
            return buf.getvalue().decode()

        return {"secret": secret, "uri": uri, "qr_svg": await asyncio.to_thread(render)}

    async def totp_enable(self, user_id: int, code: str) -> None:
        pending = await self._secrets.get(self._totp_path(user_id, pending=True))
        if not pending or not pyotp.TOTP(pending["secret"]).verify(code.strip(), valid_window=1):
            raise DomainError("Неверный код подтверждения")
        await self._secrets.put(self._totp_path(user_id), pending)
        await self._secrets.delete(self._totp_path(user_id, pending=True))
        async with self._db.session() as s:
            user = await UserRepo(s).require(user_id)
            user.totp_enabled = True
            self._audit.record(s, Actor(user.username, user.role.value), "auth.2fa_enabled")

    async def totp_disable(self, user_id: int, actor: Actor) -> None:
        await self._secrets.delete(self._totp_path(user_id))
        async with self._db.session() as s:
            user = await UserRepo(s).require(user_id)
            user.totp_enabled = False
            self._audit.record(s, actor, "auth.2fa_disabled", "panel_user", user.id, user.username)
