from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from ..container import Container
from .deps import Principal, admin, container, operator, viewer

router = APIRouter(prefix="/api", tags=["devices"])


class DeviceIn(BaseModel):
    name: str = Field(default="", max_length=128)
    platform: str
    host: str = Field(min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    transport: str = ""
    verify_tls: bool = False
    site: str = ""
    location: str = ""
    role: str = ""
    tags: list[str] = []
    note: str = ""
    enabled: bool = True
    poll_seconds: int = Field(default=300, ge=60, le=86400)
    flow_exporter_ip: str = ""
    use_system_key: bool = False
    credentials: dict[str, str | None] = {}


class DevicePatch(BaseModel):
    name: str | None = None
    platform: str | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    transport: str | None = None
    verify_tls: bool | None = None
    site: str | None = None
    location: str | None = None
    role: str | None = None
    tags: list[str] | None = None
    note: str | None = None
    enabled: bool | None = None
    poll_seconds: int | None = Field(default=None, ge=60, le=86400)
    flow_exporter_ip: str | None = None
    use_system_key: bool | None = None
    credentials: dict[str, str | None] | None = None
    clear_credentials: list[str] | None = None


class TestIn(DeviceIn):
    id: str | None = None


class ActionIn(BaseModel):
    action: str
    params: dict = {}


class DiscoverIn(BaseModel):
    target: str = Field(min_length=1, max_length=64)
    community: str = Field(default="public", max_length=64)


class EndpointPatch(BaseModel):
    alias: str | None = Field(default=None, max_length=128)
    note: str | None = Field(default=None, max_length=2000)


class BlockIn(BaseModel):
    blocked: bool = True


@router.get("/devices/platforms")
async def platforms(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return c.devices.platforms()


@router.get("/devices")
async def devices(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.devices.list()


@router.post("/devices")
async def device_create(body: DeviceIn, p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.devices.create(p.actor, body.model_dump())


@router.post("/devices/test")
async def device_test(body: TestIn, _: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.devices.test(body.model_dump())


@router.post("/devices/discover")
async def device_discover(body: DiscoverIn, _: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.devices.discover(body.target, body.community)


@router.get("/devices/{device_id}")
async def device(device_id: str, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.devices.get(device_id)


@router.patch("/devices/{device_id}")
async def device_update(device_id: str, body: DevicePatch, p: Principal = Depends(admin),
                        c: Container = Depends(container)):
    return await c.devices.update(p.actor, device_id, body.model_dump(exclude_unset=True))


@router.delete("/devices/{device_id}")
async def device_delete(device_id: str, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.devices.delete(p.actor, device_id)
    return {"ok": True}


@router.post("/devices/{device_id}/poll")
async def device_poll(device_id: str, _: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.devices.poll(device_id)


@router.post("/devices/{device_id}/actions")
async def device_action(device_id: str, body: ActionIn, p: Principal = Depends(operator),
                        c: Container = Depends(container)):
    return await c.devices.apply(p.actor, device_id, body.action, body.params)


@router.get("/devices/{device_id}/backup", response_class=PlainTextResponse)
async def device_backup(device_id: str, p: Principal = Depends(admin), c: Container = Depends(container)):
    return (await c.devices.apply(p.actor, device_id, "backup", {}))["output"]


@router.post("/devices/{device_id}/reset-host-key")
async def device_reset_key(device_id: str, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.devices.reset_host_key(p.actor, device_id)
    return {"ok": True}


@router.get("/endpoints")
async def endpoints(q: str = "", online: bool | None = None, device_id: str | None = None,
                    _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.devices.endpoints(q, online, device_id)


@router.patch("/endpoints/{mac}")
async def endpoint_update(mac: str, body: EndpointPatch, p: Principal = Depends(operator),
                          c: Container = Depends(container)):
    return await c.devices.update_endpoint(p.actor, mac, body.model_dump(exclude_unset=True))


@router.delete("/endpoints/{mac}")
async def endpoint_delete(mac: str, p: Principal = Depends(operator), c: Container = Depends(container)):
    await c.devices.forget_endpoint(p.actor, mac)
    return {"ok": True}


@router.post("/endpoints/{mac}/block")
async def endpoint_block(mac: str, body: BlockIn, p: Principal = Depends(operator), c: Container = Depends(container)):
    return await c.devices.block_endpoint(p.actor, mac, body.blocked)


@router.get("/topology")
async def topology(offline: bool = False, endpoints: bool = True, _: Principal = Depends(viewer),
                   c: Container = Depends(container)):
    return await c.topology.build(offline, endpoints)


@router.put("/topology/positions")
async def topology_positions(body: dict[str, list[float] | None], _: Principal = Depends(operator),
                             c: Container = Depends(container)):
    await c.devices.set_positions(body)
    return {"ok": True}
