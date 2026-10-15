import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import StreamingResponse

from ..container import Container
from .deps import Principal, admin, container, current, viewer
from .schemas import ServerConfigIn

router = APIRouter(prefix="/api")


@router.get("/analytics/summary")
async def summary(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.analytics.summary()


@router.get("/analytics/live")
async def live(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return c.analytics.live()


@router.get("/analytics/traffic")
async def traffic(range: str = "24h", client_id: uuid.UUID | None = None, _: Principal = Depends(viewer),
                  c: Container = Depends(container)):
    return await c.analytics.series(range, client_id)


@router.get("/analytics/top")
async def top(range: str = "24h", _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.analytics.top(range)


@router.get("/analytics/heatmap")
async def heatmap(range: str = "30d", _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.analytics.heatmap(range)


@router.get("/analytics/geo")
async def geo(range: str = "30d", _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.analytics.geo(range)


@router.get("/events")
async def events(request: Request, _: Principal = Depends(viewer), c: Container = Depends(container)):
    q = c.bus.subscribe()

    async def stream():
        try:
            yield "retry: 5000\n\n"
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            c.bus.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/alerts")
async def alerts(all: bool = False, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.alerts.list(include_resolved=all)


@router.post("/alerts/{alert_id}/ack")
async def ack(alert_id: int, p: Principal = Depends(current), c: Container = Depends(container)):
    await c.alerts.acknowledge(alert_id, p.actor)
    return {"ok": True}


@router.get("/audit")
async def audit(limit: int = 50, offset: int = 0, action: str | None = None, actor: str | None = None,
                q: str | None = None, _: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.audit.page(min(limit, 200), offset, action, actor, q)


@router.get("/server/info")
async def server_info(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.server.info()


@router.get("/server/config")
async def server_config(_: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.server.config()


@router.put("/server/config")
async def server_config_save(body: ServerConfigIn, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.server.save(p.actor, body.config)
    await c.clients.sync(p.actor)
    return {"ok": True}


@router.get("/server/backups/{name}")
async def server_backup(name: str, _: Principal = Depends(admin), c: Container = Depends(container)):
    return {"config": await c.server.backup(name)}


@router.get("/mikrotik-vpn")
async def mikrotik_vpn(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.mikrotik.info()


@router.post("/mikrotik-vpn/setup")
async def mikrotik_vpn_setup(p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.mikrotik.wg.setup()
    async with c.db.session() as s:
        c.audit.record(s, p.actor, "mikrotik_vpn.setup", "router", c.mikrotik.wg.iface, "WireGuard",
                       network=str(c.mikrotik.wg.network), port=c.mikrotik.wg.port)
    return await c.mikrotik.info()


@router.get("/routing/status")
async def routing_status(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return {"router": await c.routing.status(), "site_list": await c.routing.site_list()}


@router.post("/routing/site-list")
async def routing_upload(file: UploadFile = File(...), p: Principal = Depends(admin), c: Container = Depends(container)):
    raw = await file.read(64 * 1024 * 1024)
    return await c.routing.apply_site_list(p.actor, raw)


@router.get("/settings")
async def settings_get(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.settings.all()


@router.put("/settings")
async def settings_put(body: dict, p: Principal = Depends(admin), c: Container = Depends(container)):
    res = await c.settings.update(body)
    async with c.db.session() as s:
        c.audit.record(s, p.actor, "settings.updated", "settings", "", "", **{k: str(v) for k, v in body.items()})
    return res


@router.get("/users")
async def users(_: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.users.list()


@router.get("/spa")
async def spa_status(_: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.spa.status()


@router.post("/spa/sync")
async def spa_sync(p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.spa.sync(force=True, actor=p.actor)
