# FastAPI Production Framework

A domain-neutral, production-ready FastAPI starter. Rip out the example models,
drop in your own domain models and API routers, and you have a project that ships
with auth, caching, rate-limiting, real-time WebSocket, geo-indexing, file storage,
and observability already wired up.

## What's included

| Module | File | What it does |
|---|---|---|
| Config | `app/core/config.py` | Pydantic-settings; all values from env / `.env` |
| Database | `app/core/database.py` | Async SQLAlchemy engine, session factory, `get_db` dep |
| Auth | `app/core/auth.py` | JWT sign/verify + Redis revocation list |
| Cache | `app/core/cache.py` | Two-level cache: L1 in-process TTLCache + L2 Redis |
| Rate limit | `app/core/rate_limit.py` | Redis sliding-window per IP; IP blacklist |
| Idempotency | `app/core/idempotency.py` | Redis-locked idempotency keys (prevent duplicate POSTs) |
| WebSocket | `app/core/websocket.py` | `ConnectionManager` with Redis pub/sub fan-out |
| Geo | `app/core/geo.py` | Redis GEOADD/GEOSEARCH with Haversine fallback |
| S3 | `app/core/s3.py` | AWS S3 / MinIO / Aliyun OSS upload, delete, presign |
| Monitoring | `app/core/monitoring.py` | In-process metrics (req count, p95 latency, errors) |
| Response | `app/core/response.py` | ORJSON `success_response` / `error_response` helpers |
| Auth router | `app/api/auth.py` | `POST /api/auth/register`, `/login`, `/logout` |
| Upload router | `app/api/upload.py` | Image compress+upload, voice upload, magic-byte validation |
| Monitoring router | `app/api/monitoring.py` | `/health`, `/metrics` (Prometheus text), `/stats` (JSON) |
| Worker | `app/tasks/worker.py` | Arq background task worker template |

## Quick start

```bash
cp .env.example .env          # fill in your values
docker compose -f docker-compose.dev.yml up
```

The API is available at `http://localhost:8000`.
Swagger UI (DEBUG=true only): `http://localhost:8000/docs`

## Adding your domain

### 1. Define your models

Edit `app/models/models.py` (or add more files and import them):

```python
from sqlmodel import SQLModel, Field
from typing import Optional

class Item(SQLModel, table=True):
    id:   Optional[int] = Field(default=None, primary_key=True)
    name: str
    owner_id: int = Field(foreign_key="users.id")
```

### 2. Add your API router

```python
# app/api/items.py
from fastapi import APIRouter, Depends
from app.core.auth import get_current_user, require_role, TokenData
from app.core.database import get_db

router = APIRouter()

@router.get("")
async def list_items(token: TokenData = Depends(get_current_user)):
    ...

@router.post("")
async def create_item(token: TokenData = Depends(require_role("admin"))):
    ...
```

### 3. Register in main.py

```python
from app.api.items import router as items_router
app.include_router(items_router, prefix="/api/items", tags=["Items"])
```

## Auth

Tokens are JWTs with payload `{"sub": "<user_id>", "type": "<role>", "exp": ...}`.

```python
# Any valid token
Depends(get_current_user)

# Single role
Depends(require_role("admin"))

# Multiple accepted roles
Depends(require_role("editor", "admin"))

# Optional (public read, authenticated write)
Depends(optional_user)
```

Logout adds the token to a Redis revocation set that expires at the token's own
`exp` time — no scheduled cleanup needed.

## Two-level cache

```python
from app.core.cache import get_from_cache, set_cache, delete_cache, cache_with_lock

# Manual
key  = "users:list"
data = await get_from_cache(key)
if data is None:
    data = await fetch_from_db()
    await set_cache(key, data, ttl_l1=5, ttl_l2=300)

# Cache-stampede protection (single concurrent fetch per key)
data = await cache_with_lock(key, fetch_from_db, ttl=300)
```

## Rate limiting

Configured in `app/main.py` via the `gate_requests` middleware. Tune the limits:

```python
LOGIN_PATHS         = {"/api/auth/login"}   # strict (LOGIN_LIMIT = 20/min)
UPLOAD_PATHS_PREFIX = "/api/upload"         # UPLOAD_LIMIT = 100/min
# all other /api/* routes → 2000/min per IP
```

Add an IP to the permanent blacklist:

```python
from app.core.rate_limit import add_to_blacklist
await add_to_blacklist("1.2.3.4", reason="abuse")
```

## Idempotency

Wrap critical write operations (payments, order creation) to prevent duplicates:

```python
from app.core.idempotency import process_with_idempotency

result = await process_with_idempotency(request, lambda: do_the_work())
```

Clients send `Idempotency-Key: <uuid>` in the request header; the same response
is returned for any retry within 24 hours.

## Real-time WebSocket

```python
from app.core.websocket import manager

# Broadcast to all subscribers of a channel
await manager.broadcast("notifications", {"type": "alert", "msg": "..."})

# Targeted push to specific user IDs (works across multiple server instances via Redis pub/sub)
await manager.dispatch_to_cleaners([user_id_1, user_id_2], payload)
```

Connect from the client:
```js
const ws = new WebSocket("ws://localhost:8000/ws/orders?token=<jwt>");
```

## Geo index

```python
from app.core.geo import geo_service

# Index an entity's position
await geo_service.update_location("geo:drivers", driver_id, lat, lon)

# Find nearby entities within 5 km
results = await geo_service.get_nearby("geo:drivers", lat, lon, radius_km=5)
# → [{"id": 42, "distance_km": 1.3, "lat": ..., "lon": ...}, ...]

# Remove from index
await geo_service.remove("geo:drivers", driver_id)
```

## S3 / Object storage

Set `S3_ENABLED=true` in your `.env` and fill in the credentials. Works with
AWS S3, Aliyun OSS, and any S3-compatible endpoint (MinIO, Cloudflare R2, etc.).

The upload router (`/api/upload/image`, `/api/upload/voice`) automatically uses
S3 when enabled and falls back to local disk when it is not.

## Background tasks (Arq)

Add your tasks to `app/tasks/worker.py`:

```python
async def send_email(ctx, user_id: int, subject: str): ...

class WorkerSettings:
    functions = [send_email]
```

Run the worker:
```bash
arq app.tasks.worker.WorkerSettings
```

Enqueue from anywhere:
```python
from app.core.worker import get_worker_pool
pool = await get_worker_pool()
await pool.enqueue_job("send_email", user_id, "Welcome!")
```

## Monitoring

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | None | Liveness probe |
| `GET /api/monitoring/health` | None | Same, under API prefix |
| `GET /api/monitoring/metrics` | Bearer | Prometheus text format |
| `GET /api/monitoring/stats` | Bearer | JSON: req counts, error rates, p95 latency |

Set `X_BEARER_TOKEN` in your `.env` to protect these endpoints.

## Production deployment

```bash
cp .env.example .env           # edit all values
docker compose -f docker-compose.prod.yml up -d
```

The `docker-compose.prod.yml` also starts a background worker container.
Nginx terminates HTTP (and optionally TLS — see `nginx.conf`).

## Project structure

```
app/
├── core/          # framework — never touch for new features
│   ├── auth.py
│   ├── cache.py
│   ├── config.py
│   ├── database.py
│   ├── geo.py
│   ├── idempotency.py
│   ├── monitoring.py
│   ├── rate_limit.py
│   ├── response.py
│   ├── s3.py
│   └── websocket.py
├── api/           # routers — add yours here
│   ├── auth.py       (ships with framework)
│   ├── monitoring.py (ships with framework)
│   └── upload.py     (ships with framework)
├── models/
│   └── models.py  # User (example) — replace with your domain
├── tasks/
│   └── worker.py  # Arq worker config
└── main.py        # app bootstrap
```
