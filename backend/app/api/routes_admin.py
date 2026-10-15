from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..container import Container
from ..domain.models import Role
from .deps import Principal, admin, container, viewer

router = APIRouter(prefix="/api")


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    role: Role = Role.VIEWER
    days: int | None = Field(default=None, ge=1, le=3650)


class TelegramIn(BaseModel):
    token: str = Field(min_length=10, max_length=256)


class CustomPrefixIn(BaseModel):
    target: str = Field(min_length=1, max_length=253)
    comment: str = ""


class CheckIn(BaseModel):
    target: str = Field(min_length=1, max_length=255)


@router.get("/tokens")
async def tokens(_: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.tokens.list()


@router.post("/tokens")
async def token_create(body: TokenIn, p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.tokens.create(p.actor, p.owner_id, body.name, body.role, body.days)


@router.delete("/tokens/{token_id}")
async def token_revoke(token_id: int, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.tokens.revoke(p.actor, token_id)
    return {"ok": True}


@router.get("/notifications")
async def notifications(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return {"configured": await c.notifier.configured(), "bot": await c.notifier.bot_name()}


@router.put("/notifications/telegram")
async def telegram_token(body: TelegramIn, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.notifier.set_token(body.token)
    async with c.db.session() as s:
        c.audit.record(s, p.actor, "notifications.telegram_configured", "settings", "", "telegram")
    return {"ok": True, "bot": await c.notifier.bot_name()}


@router.post("/notifications/test")
async def telegram_test(_: Principal = Depends(admin), c: Container = Depends(container)):
    await c.notifications.test()
    return {"ok": True}


@router.get("/backups")
async def backups(_: Principal = Depends(admin), c: Container = Depends(container)):
    return c.backups.list()


@router.post("/backups")
async def backup_create(p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.backups.create(p.actor)


@router.get("/backups/{name}")
async def backup_download(name: str, p: Principal = Depends(admin), c: Container = Depends(container)):
    path = c.backups.file(name)
    async with c.db.session() as s:
        c.audit.record(s, p.actor, "backup.downloaded", "backup", "", name)
    return FileResponse(path, filename=name, media_type="application/gzip")


@router.delete("/backups/{name}")
async def backup_delete(name: str, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.backups.delete(p.actor, name)
    return {"ok": True}


@router.get("/routing/custom")
async def custom(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.routing.custom_list()


@router.post("/routing/custom")
async def custom_add(body: CustomPrefixIn, p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.routing.add_custom(p.actor, body.target, body.comment)


@router.delete("/routing/custom/{cidr:path}")
async def custom_remove(cidr: str, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.routing.remove_custom(p.actor, cidr)
    return {"ok": True}


@router.post("/routing/check")
async def routing_check(body: CheckIn, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.routing.check(body.target)
