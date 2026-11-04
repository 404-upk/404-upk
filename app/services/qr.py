import io
import secrets

import qrcode
from qrcode.image.svg import SvgPathImage

from ..config import settings
from ..models import Location

QR_KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_qr_key() -> str:
    return "".join(secrets.choice(QR_KEY_ALPHABET) for _ in range(8))


def location_url(location: Location) -> str:
    return f"{settings.public_url}/r/{location.qr_key}"


def _make(data: str) -> qrcode.QRCode:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    return qr


def qr_png(data: str) -> bytes:
    img = _make(data).make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def qr_svg(data: str) -> bytes:
    img = _make(data).make_image(image_factory=SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()
