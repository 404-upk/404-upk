import io
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Attachment, Ticket

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", ""}
MAX_SIDE = 1600

Image.MAX_IMAGE_PIXELS = 40_000_000


async def read_image(upload: UploadFile | None) -> bytes | None:
    if upload is None or not upload.filename:
        return None
    if (upload.content_type or "") not in ALLOWED_TYPES:
        raise HTTPException(400, "Можно прикрепить только фото (JPG, PNG или WEBP)")
    limit = settings.max_upload_mb * 1024 * 1024
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(400, f"Фото больше {settings.max_upload_mb} МБ, выберите поменьше")
    if not data:
        return None
    return data


def normalize_image(data: bytes) -> tuple[bytes, int, int]:
    """Перекодирует фото в JPEG: убирает EXIF (там бывает геолокация), поворачивает и уменьшает."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Не получилось открыть фото. Попробуйте другой файл в формате JPG или PNG") from exc
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True)
    return out.getvalue(), img.width, img.height


def save_attachment(db: Session, ticket: Ticket, data: bytes, original_name: str | None) -> Attachment:
    jpeg, width, height = normalize_image(data)
    key = secrets.token_hex(16) + ".jpg"
    path = settings.upload_dir / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(jpeg)
    attachment = Attachment(
        ticket=ticket,
        storage_key=key,
        original_name=(original_name or "")[:160] or None,
        file_type="image/jpeg",
        size=len(jpeg),
        width=width,
        height=height,
    )
    db.add(attachment)
    return attachment


def attachment_path(attachment: Attachment) -> Path:
    path = (settings.upload_dir / attachment.storage_key).resolve()
    if settings.upload_dir.resolve() not in path.parents:
        raise HTTPException(404, "Файл не найден")
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    return path
