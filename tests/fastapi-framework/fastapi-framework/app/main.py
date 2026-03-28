"""
Application entry point.

Bootstrap order:
    1. Lifespan: init DB tables, verify Redis connection
    2. CORS middleware
    3. HTTP gate middleware: blacklist → rate-limit → metrics
    4. Routers: add yours under "── API routers ──"

Environment variables (see .env.example):
    APP_NAME, DEBUG, DATABASE_URL, REDIS_URL, SECRET_KEY, CORS_ORIGINS, ...
"""
import logging
import os
import time
from contextlib import asynccontextmanager

logging.getLogger("sqlalchemy.engine.Engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

from app.core.config     import get_settings
from app.core.database   import init_db
from app.core.response   import ORJSONResponse
from app.core.websocket  import get_redis
from app.core.monitoring import log_request, logger

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    r = await get_redis()
    if r:
        try:
            await r.ping()
            logger.info("✅ Redis connected")
        except Exception as exc:
            logger.warning("⚠️  Redis ping failed: %s", exc)
    else:
        logger.warning("⚠️  Redis unavailable — running in degraded mode (cache/rate-limit disabled)")
    logger.info("🚀 %s started", settings.APP_NAME)
    yield
    logger.info("🛑 %s shutting down", settings.APP_NAME)


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/docs"          if settings.DEBUG else None,
    redoc_url="/redoc"        if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)


# ── Global exception handler — always returns JSON ────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled %s on %s %s: %s",
        type(exc).__name__, request.method, request.url.path, exc,
    )
    return JSONResponse(
        status_code=500,
        content={"success": False, "detail": f"{type(exc).__name__}: {exc}"},
    )


# ── CORS ──────────────────────────────────────────────────────────────────────
cors_origins = ["http://localhost:3000", "http://localhost:8080"]
if settings.CORS_ORIGINS:
    cors_origins.extend([o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ── HTTP gate: blacklist → rate-limit → metrics ───────────────────────────────
from app.core.rate_limit import check_rate_limit, check_blacklist, LOGIN_LIMIT, UPLOAD_LIMIT

# Tune these to match your route layout
LOGIN_PATHS  = {"/api/auth/login"}
UPLOAD_PATHS_PREFIX = "/api/upload"


@app.middleware("http")
async def gate_requests(request: Request, call_next):
    # 1. IP blacklist
    if await check_blacklist(request):
        return JSONResponse(status_code=403, content={"detail": "Access denied"})

    # 2. Rate limiting
    path = request.url.path
    if path in LOGIN_PATHS:
        limit = LOGIN_LIMIT           # strict — brute-force protection
    elif path.startswith(UPLOAD_PATHS_PREFIX):
        limit = UPLOAD_LIMIT
    elif path.startswith("/api/"):
        limit = 2000                  # generous default per IP per minute
    else:
        limit = None

    if limit and not await check_rate_limit(request, limit=limit):
        return JSONResponse(status_code=429, content={"detail": "Too many requests"})

    # 3. Metrics
    t0       = time.monotonic()
    response = await call_next(request)
    log_request(
        endpoint=path,
        duration=time.monotonic() - t0,
        status=response.status_code,
        method=request.method,
    )
    return response


# ── Static files ──────────────────────────────────────────────────────────────
upload_dir = settings.UPLOAD_DIR
os.makedirs(f"{upload_dir}/images", exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")

# Uncomment if you have a static directory:
# app.mount("/static", StaticFiles(directory="static"), name="static")


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME}


# ── API routers ───────────────────────────────────────────────────────────────
# Register your routers here, for example:
#
#   from app.api import users, items
#   from app.api.monitoring import router as monitoring_router
#
#   app.include_router(users.router,      prefix="/api/users",      tags=["Users"])
#   app.include_router(items.router,      prefix="/api/items",      tags=["Items"])
#   app.include_router(monitoring_router, prefix="/api/monitoring", tags=["Monitoring"])
#
# The framework ships with a working auth router and a monitoring router:
from app.api.auth       import router as auth_router
from app.api.monitoring import router as monitoring_router

app.include_router(auth_router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(monitoring_router, prefix="/api/monitoring", tags=["Monitoring"])

