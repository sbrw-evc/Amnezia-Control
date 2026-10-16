from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..container import Container
from ..services.flows import DEFAULT_THREAT_LISTS
from .deps import Principal, admin, container, viewer

router = APIRouter(prefix="/api/flows", tags=["flows"])


class VisualizeIn(BaseModel):
    start: str | None = None
    end: str | None = None
    dimensions: list[str] = []
    filter: str = ""
    limit: int = Field(default=10, ge=1, le=50)
    limitType: str = "avg"
    unit: str = "bps"
    graph: str = "stacked"
    bidirectional: bool = False
    previousPeriod: bool = False
    points: int = 200


class FilterIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    filter: str = Field(max_length=4000)
    shared: bool = True


class RecentIn(BaseModel):
    filter: str = ""
    limit: int = 100


@router.get("/fields")
async def fields(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return c.flows.fields()


@router.get("/status")
async def status(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.status()


@router.get("/overview")
async def overview(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.overview()


@router.post("/visualize")
async def visualize(body: VisualizeIn, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.visualize(body.model_dump())


@router.post("/recent")
async def recent(body: RecentIn, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.recent(body.filter, body.limit)


@router.get("/filters")
async def filters(p: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.saved_filters(p.actor)


@router.post("/filters")
async def filter_save(body: FilterIn, p: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.save_filter(p.actor, body.name, body.filter, body.shared)


@router.delete("/filters/{filter_id}")
async def filter_delete(filter_id: int, p: Principal = Depends(viewer), c: Container = Depends(container)):
    await c.flows.delete_filter(p.actor, filter_id)
    return {"ok": True}


class RuleIn(BaseModel):
    name: str = Field(default="", max_length=128)
    kind: str
    enabled: bool = True
    filter: str = Field(default="", max_length=4000)
    severity: str = "warning"
    params: dict = {}


class RulePatch(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    enabled: bool | None = None
    filter: str | None = Field(default=None, max_length=4000)
    severity: str | None = None
    params: dict | None = None


class ViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    state: dict
    shared: bool = True


@router.get("/exporters")
async def exporters(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.exporters()


@router.get("/rules/kinds")
async def rule_kinds(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return c.detector.kinds()


@router.get("/rules")
async def rules(_: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.detector.list()


@router.post("/rules")
async def rule_create(body: RuleIn, p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.detector.create(p.actor, body.model_dump())


@router.patch("/rules/{rule_id}")
async def rule_update(rule_id: int, body: RulePatch, p: Principal = Depends(admin), c: Container = Depends(container)):
    return await c.detector.update(p.actor, rule_id, body.model_dump(exclude_unset=True))


@router.delete("/rules/{rule_id}")
async def rule_delete(rule_id: int, p: Principal = Depends(admin), c: Container = Depends(container)):
    await c.detector.delete(p.actor, rule_id)
    return {"ok": True}


@router.post("/rules/{rule_id}/test")
async def rule_test(rule_id: int, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.detector.test(rule_id)


@router.get("/threats")
async def threats(hours: int = 24, _: Principal = Depends(viewer), c: Container = Depends(container)):
    return {"status": await c.settings.get("threat_status"), "enabled": await c.settings.get("threat_enabled"),
            "lists": await c.settings.get("threat_lists") or DEFAULT_THREAT_LISTS,
            "contacts": await c.flows.threat_contacts(min(max(hours, 1), 720))}


@router.post("/threats/refresh")
async def threats_refresh(p: Principal = Depends(admin), c: Container = Depends(container)):
    status = await c.refresh_threats()
    async with c.db.session() as s:
        c.audit.record(s, p.actor, "flows.threats_refreshed", "settings", "", "threat lists")
    return status


@router.get("/views")
async def views(p: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.views(p.actor)


@router.post("/views")
async def view_save(body: ViewIn, p: Principal = Depends(viewer), c: Container = Depends(container)):
    return await c.flows.save_view(p.actor, body.name, body.state, body.shared)


@router.delete("/views/{view_id}")
async def view_delete(view_id: int, p: Principal = Depends(viewer), c: Container = Depends(container)):
    await c.flows.delete_view(p.actor, view_id)
    return {"ok": True}
