from ..db.base import Database
from ..db.models import PanelUser
from ..db.repositories import SessionRepo, UserRepo
from ..domain.errors import Conflict, DomainError
from ..domain.models import Role
from .audit import AuditService
from .auth import AuthService
from .common import Actor


def user_dto(u: PanelUser) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role.value,
            "is_active": u.is_active, "totp_enabled": u.totp_enabled, "must_change_password": u.must_change_password,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "locked": bool(u.locked_until)}


class PanelUserService:
    def __init__(self, db: Database, auth: AuthService, audit: AuditService):
        self._db = db
        self._auth = auth
        self._audit = audit

    async def list(self) -> list[dict]:
        async with self._db.session() as s:
            return [user_dto(u) for u in await UserRepo(s).all(order_by=PanelUser.id)]

    async def create(self, actor: Actor, username: str, display_name: str, role: Role, password: str) -> dict:
        username = username.strip()
        if not username or len(username) > 64:
            raise DomainError("Укажите логин")
        self._auth.hasher.validate_strength(password)
        async with self._db.session() as s:
            repo = UserRepo(s)
            if await repo.by_username(username):
                raise Conflict("Пользователь с таким логином уже есть")
            u = repo.add(PanelUser(username=username, display_name=display_name, role=role,
                                   password_hash=await self._auth.hasher.ahash(password), must_change_password=True))
            await s.flush()
            self._audit.record(s, actor, "panel_user.created", "panel_user", u.id, u.username, role=role.value)
            return user_dto(u)

    async def update(self, actor: Actor, user_id: int, *, display_name=None, role: Role | None = None,
                     is_active: bool | None = None) -> dict:
        async with self._db.session() as s:
            repo = UserRepo(s)
            u = await repo.require(user_id)
            demoting = (role and role != Role.ADMIN and u.role == Role.ADMIN) or (is_active is False and u.role == Role.ADMIN)
            if demoting and await repo.count_admins() <= 1:
                raise DomainError("Нельзя убрать последнего активного администратора")
            if u.username == actor.username and (is_active is False or (role and role != u.role)):
                raise DomainError("Нельзя менять роль или отключать самого себя")
            changes = {}
            if display_name is not None:
                u.display_name = display_name
            if role is not None and role != u.role:
                changes["role"] = [u.role.value, role.value]
                u.role = role
            if is_active is not None and is_active != u.is_active:
                changes["is_active"] = is_active
                u.is_active = is_active
                if not is_active:
                    await SessionRepo(s).revoke_user(u.id)
            self._audit.record(s, actor, "panel_user.updated", "panel_user", u.id, u.username, **changes)
            return user_dto(u)

    async def reset_password(self, actor: Actor, user_id: int, password: str) -> None:
        self._auth.hasher.validate_strength(password)
        async with self._db.session() as s:
            u = await UserRepo(s).require(user_id)
            u.password_hash = await self._auth.hasher.ahash(password)
            u.must_change_password = True
            u.locked_until = None
            u.failed_attempts = 0
            await SessionRepo(s).revoke_user(u.id)
            self._audit.record(s, actor, "panel_user.password_reset", "panel_user", u.id, u.username)

    async def delete(self, actor: Actor, user_id: int) -> None:
        async with self._db.session() as s:
            repo = UserRepo(s)
            u = await repo.require(user_id)
            if u.username == actor.username:
                raise DomainError("Нельзя удалить самого себя")
            if u.role == Role.ADMIN and await repo.count_admins() <= 1:
                raise DomainError("Нельзя удалить последнего администратора")
            self._audit.record(s, actor, "panel_user.deleted", "panel_user", u.id, u.username)
            await repo.remove(u)
