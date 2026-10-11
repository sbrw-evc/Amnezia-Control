from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..container import Container
from .deps import Principal, container, viewer

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
