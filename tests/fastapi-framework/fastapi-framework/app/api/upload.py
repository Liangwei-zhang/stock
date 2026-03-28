"""
File upload router — images and audio files.

Features:
  - Magic-byte validation (not just extension)
  - Image compression + resize to MAX_IMAGE px via Pillow
  - Local disk storage by default; transparent S3 fallback when S3_ENABLED=true
  - Path-traversal guard on GET

Endpoints:
    POST /api/upload/image   — authenticated, returns {"url": "..."}
    POST /api/upload/voice   — authenticated, returns {"url": "..."}
    GET  /api/upload/images/{filename}
"""
import asyncio
import io
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

from app.core.auth     import get_current_user, TokenData
from app.core.config   import get_settings
from app.core.response import success_response

logger   = logging.getLogger(__name__)
router   = APIRouter()
settings = get_settings()

# ── Allowed types ─────────────────────────────────────────────────────────────
ALLOWED_IMAGE = {"jpeg", "jpg", "png", "gif", "webp"}
ALLOWED_VOICE = {"m4a", "mp3", "ogg", "wav", "webm"}
BLOCKED_EXT   = {
    "exe", "sh", "bat", "cmd", "ps1", "bash", "elf",
    "html", "htm", "js", "php", "asp", "jsp", "cgi",
    "sql", "sqlite", "db", "zip", "rar", "7z", "tar", "gz",
}
IMAGE_MAGIC = {
    b"\xff\xd8\xff": "jpeg",
    b"\x89PNG":      "png",
    b"GIF87a":       "gif",
    b"GIF89a":       "gif",
    b"RIFF":         "webp",
}

# ── Storage paths ─────────────────────────────────────────────────────────────
UPLOAD_DIR = Path(settings.UPLOAD_DIR)
IMAGES_DIR = UPLOAD_DIR / "images"
VOICES_DIR = UPLOAD_DIR / "voices"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
VOICES_DIR.mkdir(parents=True, exist_ok=True)

# ── Image processing constants ────────────────────────────────────────────────
MAX_IMAGE = 1920   # px — longer edge
QUALITY   = 85     # JPEG quality


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ext(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lower().lstrip(".")


def _detect_magic(data: bytes) -> str | None:
    for magic, fmt in IMAGE_MAGIC.items():
        if data.startswith(magic):
            return fmt
    return None


def _compress(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data))
    if max(img.size) > MAX_IMAGE:
        img.thumbnail((MAX_IMAGE, MAX_IMAGE), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=QUALITY, optimize=True)
    return buf.getvalue()


# Lazy S3 check
def _s3_enabled() -> bool:
    try:
        from app.core.s3 import settings as s3_cfg
        return s3_cfg.S3_ENABLED
    except Exception:
        return False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    _: TokenData = Depends(get_current_user),
):
    ext = _ext(file.filename)
    if ext in BLOCKED_EXT or ext not in ALLOWED_IMAGE:
        raise HTTPException(status_code=400, detail="File type not allowed")

    data = await file.read()
    if len(data) > settings.MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_FILE_SIZE // 1048576} MB limit")

    if not _detect_magic(data):
        raise HTTPException(status_code=400, detail="Invalid image format (magic bytes mismatch)")

    try:
        compressed = await asyncio.to_thread(_compress, data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image processing failed: {exc}")

    if _s3_enabled():
        from app.core.s3 import upload_to_s3, generate_s3_key
        s3_key, ct = generate_s3_key(file.filename or "img.jpg", "images")
        url = await upload_to_s3(compressed, s3_key, ct)
        storage = "s3"
    else:
        fname = f"{uuid.uuid4()}.jpg"
        (IMAGES_DIR / fname).write_bytes(compressed)
        url     = f"/uploads/images/{fname}"
        storage = "local"

    return success_response(data={"url": url, "storage": storage})


@router.post("/voice")
async def upload_voice(
    file: UploadFile = File(...),
    _: TokenData = Depends(get_current_user),
):
    ext = _ext(file.filename)
    if ext in BLOCKED_EXT or ext not in ALLOWED_VOICE:
        raise HTTPException(status_code=400, detail="File type not allowed")

    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file exceeds 5 MB")

    fname = f"{uuid.uuid4()}.{ext}"
    (VOICES_DIR / fname).write_bytes(data)
    return success_response(data={"url": f"/uploads/voices/{fname}"})


@router.get("/images/{filename}")
async def get_image(filename: str):
    # Path-traversal guard
    safe = Path(filename).name
    if safe != filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    fp = IMAGES_DIR / safe
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(fp, media_type="image/jpeg")
