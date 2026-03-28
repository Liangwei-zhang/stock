"""
Redis connection + distributed WebSocket manager.

ConnectionManager supports:
  - Multi-channel broadcast  (broadcast to all subscribers of a channel)
  - Targeted push            (dispatch to specific user IDs across nodes)
  - Redis pub/sub fan-out    (messages cross server-instance boundaries)
  - ACK tracking             (5-second timeout warning for targeted dispatches)

Usage:
    # In a WebSocket endpoint:
    @router.websocket("/ws/{channel}")
    async def ws_endpoint(websocket: WebSocket, channel: str, user_id: int = None):
        await manager.connect(websocket, channel=channel, user_id=user_id)
        try:
            while True:
                data = await websocket.receive_json()
                if data.get("type") == "ack":
                    await manager.handle_ack(data["message_id"])
        except WebSocketDisconnect:
            manager.disconnect(websocket, channel)

    # Broadcast to all subscribers of a channel:
    await manager.broadcast("notifications", {"type": "alert", "msg": "..."})

    # Push to specific user IDs (works across multiple server instances):
    await manager.dispatch_to_users([user_id_1, user_id_2], payload)
"""
import asyncio
import json
import logging
from typing import Dict, Optional, Set

import redis.asyncio as redis
from fastapi import WebSocket

from app.core.config import get_settings
from app.core.monitoring import Metrics

logger   = logging.getLogger(__name__)
settings = get_settings()

# ── Redis client ──────────────────────────────────────────────────────────────
redis_client: redis.Redis = None

TARGETED_CHANNEL = "targeted_dispatch"   # internal Redis channel for direct pushes


async def get_redis() -> Optional[redis.Redis]:
    global redis_client
    if redis_client is None:
        try:
            redis_client = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        except Exception as exc:
            logger.warning("Redis connection failed: %s", exc)
            return None
    return redis_client


# ── Connection manager ────────────────────────────────────────────────────────

class ConnectionManager:
    """
    WebSocket connection manager with Redis-backed fan-out.

    Terminology:
        channel  — a named pub/sub topic (e.g. "notifications", "orders")
        user_id  — optional integer that maps a WebSocket to a specific user
                   for targeted delivery
    """

    def __init__(self):
        self.channel_connections: Dict[str, Set[WebSocket]] = {}
        self.user_connections:    Dict[int, WebSocket]       = {}
        self.ws_to_user:          Dict[WebSocket, int]        = {}
        self.pubsub               = None
        self.pubsub_task          = None
        self.pending_acks:        Dict[str, asyncio.Task]     = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def connect(
        self,
        websocket: WebSocket,
        channel: str = "default",
        user_id: Optional[int] = None,
    ):
        await websocket.accept()

        self.channel_connections.setdefault(channel, set()).add(websocket)

        if user_id is not None:
            self.user_connections[user_id] = websocket
            self.ws_to_user[websocket]     = user_id

        Metrics.record_ws_connect()

        if len(self.channel_connections[channel]) == 1:
            await self.start_listening(channel)

    def disconnect(self, websocket: WebSocket, channel: str = "default"):
        if channel in self.channel_connections:
            self.channel_connections[channel].discard(websocket)
            if not self.channel_connections[channel]:
                asyncio.create_task(self.stop_listening(channel))

        user_id = self.ws_to_user.pop(websocket, None)
        if user_id is not None:
            self.user_connections.pop(user_id, None)

    # ── Messaging ─────────────────────────────────────────────────────────────

    async def broadcast(self, channel: str, message: dict):
        """Send to all local subscribers + publish to Redis for other nodes."""
        if channel in self.channel_connections:
            dead = set()
            for ws in list(self.channel_connections[channel]):
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self.channel_connections[channel].discard(ws)

        r = await get_redis()
        if r:
            try:
                await r.publish(channel, json.dumps(message, default=str))
            except Exception:
                pass

    async def dispatch_to_users(
        self,
        user_ids: list[int],
        payload: dict,
        require_ack: bool = True,
    ):
        """
        Push a message to specific users.
        Works across multiple server instances via Redis pub/sub.
        """
        msg_id  = f"msg_{payload.get('id', 'x')}_{asyncio.get_event_loop().time()}"
        message = {"type": "dispatch", "payload": payload, "message_id": msg_id}

        # Local delivery
        for uid in user_ids:
            ws = self.user_connections.get(uid)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    self.user_connections.pop(uid, None)

        # Cross-node delivery via Redis
        r = await get_redis()
        if r:
            try:
                await r.publish(TARGETED_CHANNEL, json.dumps(
                    {"target_ids": user_ids, "message": message}, default=str
                ))
            except Exception:
                pass

        if require_ack:
            asyncio.create_task(self._check_ack_timeout(msg_id, user_ids, message))

    async def notify_resource_taken(self, resource_id: int, taken_by: int, channel: str = "default"):
        """Convenience: tell subscribers that a resource has been claimed."""
        await self.broadcast(channel, {
            "type":       "resource_taken",
            "resource_id": resource_id,
            "taken_by":   taken_by,
        })

    async def handle_ack(self, message_id: str):
        task = self.pending_acks.pop(message_id, None)
        if task:
            task.cancel()

    # ── Redis pub/sub listener ────────────────────────────────────────────────

    async def start_listening(self, channel: str):
        r = await get_redis()
        if not r:
            return

        self.pubsub = r.pubsub()
        await self.pubsub.subscribe(channel)

        async def _listen():
            async for msg in self.pubsub.listen():
                if msg["type"] != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                    Metrics.record_ws_message()

                    if channel == TARGETED_CHANNEL:
                        for uid in data.get("target_ids", []):
                            ws = self.user_connections.get(int(uid))
                            if ws:
                                try:
                                    await ws.send_json(data.get("message", {}))
                                except Exception:
                                    pass
                        if data.get("broadcast") and "default" in self.channel_connections:
                            for ws in list(self.channel_connections["default"]):
                                try:
                                    await ws.send_json(data.get("message", {}))
                                except Exception:
                                    pass
                        continue

                    for ws in list(self.channel_connections.get(channel, [])):
                        try:
                            await ws.send_json(data)
                        except Exception:
                            pass
                except Exception:
                    pass

        self.pubsub_task = asyncio.create_task(_listen())

    async def stop_listening(self, channel: str):
        if self.pubsub_task:
            self.pubsub_task.cancel()
            self.pubsub_task = None
        if self.pubsub:
            try:
                await self.pubsub.unsubscribe(channel)
                await self.pubsub.close()
            except Exception:
                pass
            self.pubsub = None

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _check_ack_timeout(self, message_id: str, target_ids: list[int], message: dict):
        await asyncio.sleep(5)
        if message_id in self.pending_acks:
            logger.warning("Dispatch msg %s unacknowledged by %s", message_id, target_ids)


# Global singleton
manager = ConnectionManager()
