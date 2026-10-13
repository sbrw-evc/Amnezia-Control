import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse

from ..container import Container
from ..domain.models import BlockReason
from .deps import Principal, client_ip, container, operator, viewer
from .schemas import BulkIn, ClientIn, ClientPatch, ShareIn

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _bundle_dto(b) -> dict:
    return {"name": b.name, "config": b.config, "amnezia_key": b.amnezia_key, "qr_svg": b.qr_svg}


def _filename(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)[:40] or "client"


@router.get("")
async def list_clients(q: str | None = None, status: str | None = None, tag: str | None = None,
                       server: str | None = None, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.clients.list(q, status, tag, server)


@router.get("/servers")
async def servers(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.clients.servers()


@router.get("/tags")
async def tags(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.clients.tags()


@router.post("")
async def create(body: ClientIn, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.create(p.actor, **body.model_dump())


@router.post("/sync")
async def sync(p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.sync(p.actor)


@router.post("/bulk")
async def bulk(body: BulkIn, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.bulk(p.actor, body.ids, body.action)


@router.get("/{client_id}")
async def get(client_id: uuid.UUID, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.clients.get(client_id)


@router.patch("/{client_id}")
async def update(client_id: uuid.UUID, body: ClientPatch, p: Principal = Depends(operator),
                 c: Container = Depends(container)):
    return await c.clients.update(p.actor, client_id, body.model_dump(exclude_unset=True))


@router.post("/{client_id}/block")
async def block(client_id: uuid.UUID, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.set_blocked(p.actor, client_id, True, BlockReason.MANUAL)


@router.post("/{client_id}/unblock")
async def unblock(client_id: uuid.UUID, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.set_blocked(p.actor, client_id, False)


@router.post("/{client_id}/reissue")
async def reissue(client_id: uuid.UUID, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.reissue(p.actor, client_id)


@router.delete("/{client_id}")
async def delete(client_id: uuid.UUID, p: Principal = Depends(operator), c: Container = Depends(container)):
    await c.clients.delete(p.actor, client_id)
    return {"ok": True}


@router.get("/{client_id}/config")
async def config(client_id: uuid.UUID, p: Principal = Depends(operator), c: Container = Depends(container)):
    return _bundle_dto(await c.clients.bundle(p.actor, client_id))


@router.get("/{client_id}/config.conf")
async def config_file(client_id: uuid.UUID, p: Principal = Depends(operator), c: Container = Depends(container)):
    b = await c.clients.bundle(p.actor, client_id)
    return PlainTextResponse(b.config, headers={"Content-Disposition": f'attachment; filename="{_filename(b.name)}.conf"'})


@router.post("/{client_id}/share")
async def share(client_id: uuid.UUID, body: ShareIn, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.clients.create_share_link(p.actor, client_id, body.hours)


public = APIRouter(prefix="/api/public", tags=["public"])


@public.get("/share/{token}")
async def share_open(token: str, request: Request, c: Container = Depends(container)):
    return _bundle_dto(await c.clients.consume_share_link(token, client_ip(request)))
