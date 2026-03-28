"""
Monitoring endpoints — protected by X_BEARER_TOKEN (internal use only).

GET /api/monitoring/health    — public liveness probe
GET /api/monitoring/metrics   — Prometheus-compatible text format
GET /api/monitoring/stats     — JSON summary (requests, errors, p95 latencies)
"""
from fastapi import APIRouter, Depends, Response

from app.core.auth       import require_bearer
from app.core.config     import get_settings
from app.core.monitoring import Metrics

router   = APIRouter()
settings = get_settings()


@router.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}


@router.get("/metrics", dependencies=[Depends(require_bearer)])
async def prometheus_metrics():
    stats = Metrics.get_stats()
    app   = settings.APP_NAME.lower().replace(" ", "_")
    lines = [
        f"# HELP {app}_http_requests_total Total HTTP requests",
        f"# TYPE {app}_http_requests_total counter",
    ]
    for endpoint, data in stats.get("endpoints", {}).items():
        lines.append(f'{app}_http_requests_total{{endpoint="{endpoint}"}} {data.get("requests", 0)}')
    lines += [
        "",
        f"# HELP {app}_ws_connections_total WebSocket connections",
        f"# TYPE {app}_ws_connections_total gauge",
        f'{app}_ws_connections_total {stats.get("websocket", {}).get("total_connections", 0)}',
    ]
    return Response(content="\n".join(lines), media_type="text/plain")


@router.get("/stats", dependencies=[Depends(require_bearer)])
async def json_stats():
    stats = Metrics.get_stats()
    return {
        "requests":              sum(d.get("requests", 0) for d in stats.get("endpoints", {}).values()),
        "errors":                sum(d.get("errors",   0) for d in stats.get("endpoints", {}).values()),
        "websocket_connections": stats.get("websocket", {}).get("total_connections", 0),
        "endpoints":             stats.get("endpoints", {}),
        "timestamp":             stats.get("timestamp"),
    }
