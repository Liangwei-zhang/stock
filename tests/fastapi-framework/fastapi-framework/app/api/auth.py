"""
Auth router — login / logout / register.

JWT token payload: {"sub": "<user_id>", "type": "<role>", "exp": <unix_ts>}

Endpoints:
    POST /api/auth/register  — create account
    POST /api/auth/login     — returns JWT
    POST /api/auth/logout    — revokes JWT via Redis blacklist

Protect any other endpoint with:
    Depends(require_role("admin"))         # single role
    Depends(require_role("user", "admin")) # multiple accepted roles
    Depends(get_current_user)              # any valid token
"""
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException
from jose import jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config   import get_settings
from app.core.database import get_db
from app.core.response import success_response
from app.core.websocket import get_redis
from app.models.models import User

router   = APIRouter()
settings = get_settings()


# ── Password helpers ──────────────────────────────────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain[:72].encode(), hashed.encode())
    except Exception:
        return False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password[:72].encode(), bcrypt.gensalt()).decode()


# ── Token helpers ─────────────────────────────────────────────────────────────

def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "type": role, "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


async def revoke_token(token: str) -> bool:
    r = await get_redis()
    if not r:
        return False
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        ttl = max(int(payload.get("exp", 0)) - int(datetime.utcnow().timestamp()), 60)
    except Exception:
        ttl = 60 * 60 * 24 * 7  # fallback: 7 days
    try:
        await r.setex(f"token_revoked:{token}", ttl, "1")
        return True
    except Exception:
        return False


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name:     str
    email:    str
    password: str
    role:     str = "user"


class LoginRequest(BaseModel):
    email:    str
    password: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=req.name,
        email=req.email,
        password_hash=hash_password(req.password),
        role=req.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return success_response(data={"id": user.id}, message="Account created")


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == req.email))).scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id, user.role)
    return success_response(data={
        "token":   token,
        "user_id": user.id,
        "role":    user.role,
        "name":    user.name,
    })


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    await revoke_token(token)
    return success_response(message="Logged out")
