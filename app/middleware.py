"""Общие обработчики запросов: защитные заголовки, проверка источника запроса, сжатие и чистка журналов."""

import logging
import re
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.gzip import GZipMiddleware

from .config import settings

_TRACKING_PATH = re.compile(r"(/t/|/api/track/)[A-Za-z0-9-]{8,}")


def hide_tracking_code(value: str) -> str:
    return _TRACKING_PATH.sub(r"\1***", value)


class HideTrackingCodes(logging.Filter):
    """Код отслеживания даёт доступ к заявке, поэтому в журналы сервера он не попадает."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(hide_tracking_code(a) if isinstance(a, str) else a for a in record.args)
        return True


logging.getLogger("uvicorn.access").addFilter(HideTrackingCodes())

CSP = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; "
    "script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; "
    "base-uri 'self'; form-action 'self'" + ("; upgrade-insecure-requests" if settings.is_https else "")
)
# страницы, которые стоит показывать в поиске; заявки, панель и страницы кабинетов закрыты от индексации
INDEXABLE = {"/", "/privacy", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/favicon.ico"}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MAX_BODY = (settings.max_upload_mb + 1) * 1024 * 1024


def _same_origin(request: Request, origin: str) -> bool:
    host = urlsplit(origin).netloc
    return host in {request.headers.get("host"), urlsplit(settings.public_url).netloc}


async def security_headers(request: Request, call_next):
    path = request.url.path
    if request.method in UNSAFE_METHODS:
        # запрос с чужого сайта не должен действовать от имени вошедшего сотрудника
        origin = request.headers.get("origin")
        if origin and not _same_origin(request, origin):
            return JSONResponse({"detail": "Запрос с другого сайта отклонён"}, status_code=403)
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY:
            return JSONResponse(
                {"detail": f"Файл больше {settings.max_upload_mb} МБ, выберите поменьше"}, status_code=413
            )

    response = await call_next(request)

    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    # код отслеживания лежит в адресе страницы, его нельзя отдавать сторонним сайтам
    headers.setdefault("Referrer-Policy", "no-referrer")
    # камера разрешена только самому сайту: в окне «Фото к заявке» можно снять прямо на странице
    headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=(self), payment=(), usb=()")
    headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if settings.is_https:
        headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if not path.startswith("/api/docs"):
        headers.setdefault("Content-Security-Policy", CSP)
    if path.startswith("/api/"):
        headers.setdefault("Cache-Control", "no-store")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    elif path.startswith("/static/fonts/"):
        headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    elif path.startswith("/static/img/"):
        headers.setdefault("Cache-Control", "public, max-age=604800")
    elif path.startswith("/static/"):
        # браузер переспрашивает сервер и получает 304, если файл не менялся; после обновления сразу видна новая версия
        headers.setdefault("Cache-Control", "no-cache")
    if path not in INDEXABLE and not path.startswith("/static/"):
        headers.setdefault("X-Robots-Tag", "noindex, nofollow")
    return response


class CompressText:
    """Сжимает текст; шрифты, картинки и вложения и так сжаты, тратить на них процессор незачем."""

    SKIP = ("/static/fonts/", "/static/img/")

    def __init__(self, inner) -> None:
        self.inner = inner
        self.gzip = GZipMiddleware(inner, minimum_size=1024)

    async def __call__(self, scope, receive, send) -> None:
        path = scope.get("path", "")
        skip = path.startswith(self.SKIP) and not path.endswith(".svg")  # SVG это текст и сжимается хорошо
        plain = scope["type"] != "http" or skip or "/attachments/" in path
        await (self.inner if plain else self.gzip)(scope, receive, send)
