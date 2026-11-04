import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .ai import resilience
from .ai.gigachat import client as gigachat
from .config import WEB_DIR, settings
from .db import SessionLocal, init_db
from .middleware import CompressText, HideTrackingCodes, hide_tracking_code, security_headers
from .models import User
from .routers import auth, manage, pages, public, staff, track
from .seed import seed
from .services.retention import retention_loop
from .services.telegram import bot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("upk")
logging.getLogger("uvicorn.access").addFilter(HideTrackingCodes())
# httpx пишет в журнал полный адрес запроса, а в адресе Telegram Bot API лежит токен бота
logging.getLogger("httpx").setLevel(logging.WARNING)


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

app.middleware("http")(security_headers)
app.add_middleware(CompressText)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    path = request.url.path
    wants_page = request.method in ("GET", "HEAD") and "text/html" in request.headers.get("accept", "")
    if exc.status_code == 404 and wants_page and not path.startswith(("/api/", "/static/")):
        return pages.page("404.html", request, status_code=404)
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
        # degraded: GigaChat несколько раз подряд не ответил, и помощник временно отвечает по правилам
        "ai": ("degraded" if resilience.breaker.is_open else "gigachat") if gigachat.enabled else "demo",
        "telegram": bot.enabled,
    }
    return JSONResponse(body, status_code=200 if database else 503)


for module in (public, track, auth, staff, manage):
    app.include_router(module.router)

app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")
app.include_router(pages.router)
