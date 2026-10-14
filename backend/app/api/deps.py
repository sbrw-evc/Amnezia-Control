from dataclasses import dataclass

from fastapi import Depends, Request

from ..container import Container
from ..db.models import PanelSession, PanelUser
from ..domain.errors import Forbidden, Unauthorized
from ..domain.models import Role
from ..services.common import Actor

COOKIE = "nc_session"
CSRF_HEADER = "network-control"


def container(request: Request) -> Container:
    return request.app.state.container


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


@dataclass
class Principal:
    actor: Actor
    role: Role
    user: PanelUser | None = None
    session: PanelSession | None = None
    token: str | None = None
    must_change_password: bool = False


async def current(request: Request, c: Container = Depends(container)) -> Principal:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        t = await c.tokens.authenticate(auth[7:].strip())
        return Principal(Actor(f"token:{t.name}", t.role.value, client_ip(request)), t.role)
    if request.method not in ("GET", "HEAD") and request.headers.get("x-requested-with") != CSRF_HEADER:
        raise Forbidden("CSRF check failed")
    token = request.cookies.get(COOKIE)
    user, sess = await c.auth.authenticate(token)
    return Principal(Actor(user.username, user.role.value, client_ip(request)), user.role, user, sess, token,
                     user.must_change_password)


async def session_user(p: Principal = Depends(current)) -> Principal:
    if p.user is None:
        raise Forbidden("Доступно только для входа через браузер")
    return p


def require(role: Role):
    async def dep(p: Principal = Depends(current)) -> Principal:
        if p.must_change_password and role != Role.VIEWER:
            raise Forbidden("Сначала смените пароль")
        if not p.role.allows(role):
            raise Forbidden("Недостаточно прав")
        return p
    return dep


viewer = require(Role.VIEWER)
operator = require(Role.OPERATOR)
admin = require(Role.ADMIN)

__all__ = ["COOKIE", "Principal", "admin", "client_ip", "container", "current", "operator", "session_user", "viewer",
           "Unauthorized"]
