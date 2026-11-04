import asyncio
import hashlib
import logging
import re
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware

from .ai.gigachat import client as gigachat
from .config import WEB_DIR, settings
from .db import SessionLocal, init_db
from .models import User
from .routers import auth, manage, public, staff, track
from .seed import seed
from .services.retention import retention_loop
from .services.telegram import bot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("upk")

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


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.ensure_production_ready()
    init_db()
    with SessionLocal() as db:
        if not db.scalar(select(func.count(User.id))):
            seed(db, demo_tickets=settings.seed_demo)
            log.info("База заполнена начальными данными")
    if not gigachat.enabled:
        log.warning("GIGACHAT_AUTH_KEY не задан: ИИ работает в демо-режиме на правилах")
    await bot.start()
    retention = asyncio.create_task(retention_loop())
    yield
    retention.cancel()
    await bot.stop()
    await gigachat.close()


app = FastAPI(
    title="УПК: цифровой помощник колледжа",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.enable_docs else None,
)

CSP = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
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


@app.middleware("http")
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
    headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=()")
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
        plain = scope["type"] != "http" or path.startswith(self.SKIP) or "/attachments/" in path
        await (self.inner if plain else self.gzip)(scope, receive, send)


app.add_middleware(CompressText)


def page(name: str, request: Request, status_code: int = 200) -> Response:
    html = (WEB_DIR / name).read_text(encoding="utf-8").replace("%PUBLIC_URL%", settings.public_url)
    etag = f'"{hashlib.sha256(html.encode()).hexdigest()[:20]}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if status_code == 200 and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(html, status_code=status_code, headers=headers)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    path = request.url.path
    wants_page = request.method in ("GET", "HEAD") and "text/html" in request.headers.get("accept", "")
    if exc.status_code == 404 and wants_page and not path.startswith(("/api/", "/static/")):
        return page("404.html", request, status_code=404)
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    fields = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
        if loc:
            fields.append(loc[-1])
    detail = "Проверьте заполнение полей" + (f": {', '.join(sorted(set(fields)))}" if fields else "")
    return JSONResponse({"detail": detail, "errors": exc.errors()}, status_code=422)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    log.exception("Ошибка при обработке %s %s", request.method, hide_tracking_code(request.url.path))
    return JSONResponse({"detail": "На сервере что-то пошло не так. Попробуйте ещё раз через минуту."}, status_code=500)


@app.get("/api/health", tags=["Служебное"])
def health():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        database = True
    except SQLAlchemyError:
        log.exception("База данных недоступна")
        database = False
    body = {
        "status": "ok" if database else "degraded",
        "database": database,
        "ai": "gigachat" if gigachat.enabled else "demo",
        "telegram": bot.enabled,
    }
    return JSONResponse(body, status_code=200 if database else 503)


for module in (public, track, auth, staff, manage):
    app.include_router(module.router)

app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
@app.get("/r/{qr_key}", include_in_schema=False)
def report_page(request: Request, qr_key: str | None = None):
    return page("index.html", request)


@app.get("/track", include_in_schema=False)
@app.get("/t/{code}", include_in_schema=False)
def track_page(request: Request, code: str | None = None):
    return page("track.html", request)


@app.get("/admin", include_in_schema=False)
def admin_page(request: Request):
    return page("admin.html", request)


@app.get("/admin/qr-print", include_in_schema=False)
def qr_print_page(request: Request):
    return page("qr-print.html", request)


@app.get("/privacy", include_in_schema=False)
def privacy_page(request: Request):
    return page("privacy.html", request)


@app.get("/robots.txt", include_in_schema=False)
def robots():
    return PlainTextResponse(
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /admin\n"
        "Disallow: /api/\n"
        "Disallow: /r/\n"
        "Disallow: /t/\n"
        "Disallow: /track\n"
        f"\nSitemap: {settings.public_url}/sitemap.xml\n"
    )


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap():
    urls = "".join(f"<url><loc>{settings.public_url}{path}</loc></url>" for path in ("/", "/privacy"))
    body = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return Response(body, media_type="application/xml")


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(WEB_DIR / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(WEB_DIR / "static" / "img" / "icon.svg", media_type="image/svg+xml")
