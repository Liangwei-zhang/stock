"""
JWT auth middleware — no DB queries, Redis-based token revocation.

Usage:
    # Protect any endpoint with a role guard:
    @router.get("/my-endpoint")
    async def my_view(token: TokenData = Depends(require_role("admin"))):
        ...

    # Or use the low-level dependency directly:
    async def my_view(token: TokenData = Depends(get_current_user)):
        ...

Token payload expected:
    { "sub": "<user_id>", "type": "<role>", "exp": <unix_ts> }
"""
import logging
import secrets
from typing import Optional
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt, ExpiredSignatureError

from app.core.config import get_settings
from app.core.websocket import get_redis

logger   = logging.getLogger(__name__)
settings = get_settings()
security = HTTPBearer(auto_error=False)


class TokenData:
    __slots__ = ("user_id", "user_type")

    def __init__(self, user_id: int, user_type: str):
        self.user_id   = user_id
        self.user_type = user_type


async def _decode_token(token: str) -> TokenData:
    """Validate JWT signature + expiry + Redis revocation list."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id   = payload.get("sub")
    user_type = payload.get("type")
    if not user_id or not user_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token payload")

    # O(1) revocation check — no DB hit
    r = await get_redis()
    if r:
        try:
            if await r.get(f"token_revoked:{token}"):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Redis revocation check failed: %s", exc)

    return TokenData(user_id=int(user_id), user_type=user_type)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> TokenData:
    """Any valid token, any role."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token")
    return await _decode_token(credentials.credentials)


def require_role(*roles: str):
    """
    Factory that returns a FastAPI dependency enforcing one of the given roles.

    Example:
        Depends(require_role("admin"))
        Depends(require_role("editor", "admin"))
    """
    async def _guard(token: TokenData = Depends(get_current_user)) -> TokenData:
        if token.user_type not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {' or '.join(roles)}",
            )
        return token
    return _guard


# ── Optional auth (public read, authenticated write) ─────────────────────────
async def optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[TokenData]:
    """Returns None if no token present, TokenData if token is valid."""
    if not credentials:
        return None
    try:
        return await _decode_token(credentials.credentials)
    except HTTPException:
        return None


# ── Internal bearer (inter-service / admin script calls) ─────────────────────
async def require_bearer(authorization: Optional[str] = Header(None)) -> None:
    """Validate X_BEARER_TOKEN for internal endpoints (monitoring, cron, etc.)."""
    expected = settings.X_BEARER_TOKEN
    if not expected:
        return  # Disabled when env var not set
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    if not secrets.compare_digest(authorization.split(" ", 1)[1], expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid Bearer token")
