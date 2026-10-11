from fastapi import APIRouter, Depends, Request, Response

from ..container import Container
from ..domain.errors import Unauthorized
from ..services.users import user_dto
from .deps import COOKIE, Principal, client_ip, container, session_user
from .schemas import CodeIn, LoginIn, PasswordChangeIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(resp: Response, token: str, c: Container) -> None:
    resp.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=c.cfg.cookie_secure,
                    max_age=c.cfg.session_ttl_hours * 3600, path="/")


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, c: Container = Depends(container)):
    res = await c.auth.login(body.username, body.password, client_ip(request), request.headers.get("user-agent", ""))
    _set_cookie(response, res.token, c)
    return {"requires_2fa": res.requires_2fa, "user": None if res.requires_2fa else user_dto(res.user)}


@router.post("/2fa")
async def second_factor(body: CodeIn, request: Request, c: Container = Depends(container)):
    token = request.cookies.get(COOKIE)
    if not token:
        raise Unauthorized("Сессия входа истекла")
    user = await c.auth.verify_2fa(token, body.code, client_ip(request))
    return {"user": user_dto(user)}


@router.post("/logout")
async def logout(request: Request, response: Response, c: Container = Depends(container)):
    token = request.cookies.get(COOKIE)
    if token:
        await c.auth.logout(token)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(p: Principal = Depends(session_user)):
    return user_dto(p.user)


@router.post("/password")
async def change_password(body: PasswordChangeIn, p: Principal = Depends(session_user), c: Container = Depends(container)):
    await c.auth.change_password(p.user.id, body.current, body.new, p.token)
    return {"ok": True}


@router.get("/sessions")
async def sessions(p: Principal = Depends(session_user), c: Container = Depends(container)):
    return await c.auth.sessions(p.user.id, p.token)


@router.delete("/sessions/{sid}")
async def revoke(sid: str, p: Principal = Depends(session_user), c: Container = Depends(container)):
    await c.auth.revoke_session(p.user.id, sid)
    return {"ok": True}


@router.post("/totp/setup")
async def totp_setup(p: Principal = Depends(session_user), c: Container = Depends(container)):
    return await c.auth.totp_begin(p.user)


@router.post("/totp/enable")
async def totp_enable(body: CodeIn, p: Principal = Depends(session_user), c: Container = Depends(container)):
    await c.auth.totp_enable(p.user.id, body.code)
    return {"ok": True}


@router.post("/totp/disable")
async def totp_disable(p: Principal = Depends(session_user), c: Container = Depends(container)):
    await c.auth.totp_disable(p.user.id, p.actor)
    return {"ok": True}
