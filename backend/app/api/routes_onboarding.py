from fastapi import APIRouter, Depends

from ..container import Container
from ..domain.errors import NotFound
from .deps import Principal, container, viewer

router = APIRouter(prefix="/api", tags=["onboarding"])


@router.get("/onboarding")
async def onboarding(p: Principal = Depends(viewer), c: Container = Depends(container)):
    """The "First steps" checklist of the overview page, for the role of the caller."""
    return await c.onboarding.checklist(p.role)


@router.get("/guides/{page}")
async def guide(page: str, p: Principal = Depends(viewer), c: Container = Depends(container)):
    """The step-by-step setup guide of a page (devices, flows, clients, routing, settings)."""
    g = await c.onboarding.guide(page, p.role)
    if g is None:
        raise NotFound("This page has no setup guide")
    return g
