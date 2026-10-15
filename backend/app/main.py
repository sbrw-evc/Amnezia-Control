import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .api import routes_admin, routes_auth, routes_clients, routes_devices, routes_flows, routes_ops
from .config import get_settings
from .container import Container
from .domain.errors import DomainError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

VERSION = "2.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    c = Container(get_settings())
    app.state.container = c
    await c.start()
    yield
    await c.stop()


app = FastAPI(title="Network Control", version=VERSION, lifespan=lifespan, docs_url="/api/docs", redoc_url=None,
              openapi_url="/api/openapi.json")


@app.exception_handler(DomainError)
async def domain_error(_: Request, e: DomainError):
    return JSONResponse({"detail": e.message}, status_code=e.status)


@app.exception_handler(ValueError)
async def value_error(_: Request, e: ValueError):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:])
    return JSONResponse({"detail": f"Invalid field {field}: {first.get('msg', '')}"}, status_code=422)


@app.get("/api/health")
async def health():
    return {"ok": True, "version": VERSION}


for r in (routes_auth.router, routes_clients.router, routes_clients.public, routes_ops.router, routes_admin.router,
          routes_flows.router, routes_devices.router):
    app.include_router(r)
