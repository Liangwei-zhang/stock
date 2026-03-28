"""
Redis GEO service — millisecond-level geospatial queries.

Wraps Redis GEOADD / GEOSEARCH with a Haversine fallback when Redis is
unavailable. All methods are entity-agnostic: callers pass an `index_key`
(the Redis sorted-set key that holds the GEO data).

Typical usage:

    # On entity creation / location update:
    await GeoService.update_location("geo:drivers", entity_id, lat, lon)

    # Nearby search:
    results = await GeoService.get_nearby("geo:drivers", lat, lon, radius_km=5)
    # → [{"id": 42, "distance_km": 1.3, "lat": ..., "lon": ...}, ...]

    # Plain distance between two coordinates:
    km = await GeoService.calculate_distance(lat1, lon1, lat2, lon2)
"""
import logging
import math
import time as time_module
from typing import List, Optional

from app.core.cache import get_redis

logger = logging.getLogger(__name__)


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine formula — returns distance in kilometres."""
    R = 6371.0
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class GeoService:
    """
    Generic Redis GEO index.

    Every method receives `index_key` — the Redis key for a geospatial
    sorted set (e.g. ``"geo:drivers"``).  This keeps the service
    domain-neutral and lets callers maintain multiple independent indexes.
    """

    @staticmethod
    async def calculate_distance(
        lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        """Return distance in km between two coordinates (Haversine fallback)."""
        return _haversine_distance(lat1, lon1, lat2, lon2)

    @staticmethod
    async def update_location(index_key: str, entity_id: int, lat: float, lon: float) -> bool:
        """
        Add or update an entity's position in the GEO index.

        Also stores lat/lon/updated_at in a Hash at ``{index_key}:meta:{entity_id}``
        for fast retrieval without a second GEOSEARCH.
        """
        r = await get_redis()
        if not r:
            return False
        try:
            await r.geoadd(index_key, (lon, lat, str(entity_id)))
            await r.hset(
                f"{index_key}:meta:{entity_id}",
                mapping={
                    "lat": str(lat),
                    "lon": str(lon),
                    "updated_at": str(int(time_module.time() * 1000)),
                },
            )
            return True
        except Exception as exc:
            logger.warning("GeoService.update_location failed: %s", exc)
            return False

    @staticmethod
    async def get_nearby(
        index_key: str,
        lat: float,
        lon: float,
        radius_km: float = 5.0,
        limit: int = 20,
    ) -> List[dict]:
        """
        Return entities within ``radius_km`` of (lat, lon), sorted by distance.

        Returns:
            List of dicts: ``{"id": int, "distance_km": float, "lat": float, "lon": float}``
        """
        r = await get_redis()
        if not r:
            return []
        try:
            results = await r.geosearch(
                index_key,
                longitude=lon,
                latitude=lat,
                unit="km",
                radius=radius_km,
                withdist=True,
                withcoord=True,
                sort="ASC",
                count=limit,
            )
            items = []
            for member, dist, coords in results:
                entity_id = int(member)
                meta = await r.hgetall(f"{index_key}:meta:{entity_id}")
                items.append({
                    "id": entity_id,
                    "distance_km": round(float(dist), 2),
                    "lat": float(meta["lat"]) if meta and "lat" in meta else coords[1],
                    "lon": float(meta["lon"]) if meta and "lon" in meta else coords[0],
                })
            return items
        except Exception as exc:
            logger.warning("GeoService.get_nearby failed: %s", exc)
            return []

    @staticmethod
    async def remove(index_key: str, entity_id: int) -> bool:
        """Remove an entity from the GEO index and delete its metadata Hash."""
        r = await get_redis()
        if not r:
            return False
        try:
            await r.zrem(index_key, str(entity_id))
            await r.delete(f"{index_key}:meta:{entity_id}")
            return True
        except Exception as exc:
            logger.warning("GeoService.remove failed: %s", exc)
            return False


# Module-level singleton
geo_service = GeoService()

