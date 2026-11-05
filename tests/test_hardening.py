"""Безопасность, приватность, производительность, SEO и миграции."""

import logging
from datetime import timedelta

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi import HTTPException
from sqlalchemy import event, select
from starlette.requests import Request

from app import security
from app.ai.text import mask_personal
from app.config import Settings, settings
from app.db import Base, SessionLocal, engine
from app.main import HideTrackingCodes
from app.models import AiLog, Ticket, utcnow
from app.services.retention import purge

from .conftest import create_ticket, login

HTML = {"accept": "text/html"}


def test_security_headers_on_pages_and_api(client):
    for path in ("/", "/api/health"):
        headers = client.get(path).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "no-referrer"
        assert headers["cross-origin-opener-policy"] == "same-origin"
        csp = headers["content-security-policy"]
        assert "script-src 'self'" in csp and "object-src 'none'" in csp
        assert "unsafe-eval" not in csp


def test_api_answers_are_not_cached(client):
    assert client.get("/api/meta").headers["cache-control"] == "no-store"


def test_request_from_another_site_is_rejected(client):
    bad = client.post("/api/auth/logout", headers={"origin": "https://evil.example"})
    assert bad.status_code == 403
    good = client.post("/api/auth/logout", headers={"origin": "http://testserver"})
    assert good.status_code == 200


def test_too_large_body_is_rejected_before_reading(client):
    size = (settings.max_upload_mb + 2) * 1024 * 1024
    resp = client.post("/api/tickets", headers={"content-length": str(size)}, content=b"")
    assert resp.status_code == 413


def _request(forwarded: str) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(b"x-forwarded-for", forwarded.encode())],
            "client": ("10.0.0.1", 1234),
        }
    )


def test_forged_forwarded_header_does_not_change_client_ip(monkeypatch):
    # прокси дописывает настоящий адрес в конец, всё, что левее, мог прислать клиент
    monkeypatch.setattr(settings, "trust_proxy", True)
    assert security.client_ip(_request("1.1.1.1, 203.0.113.9")) == "203.0.113.9"
    monkeypatch.setattr(settings, "trust_proxy", False)
    assert security.client_ip(_request("1.1.1.1")) == "10.0.0.1"


def test_login_is_limited_per_address_across_logins(client):
    client.cookies.clear()
    for i in range(security.login_ip_limiter.limit):
        client.post("/api/auth/login", json={"login": f"user{i}", "password": "wrong-password"})
    resp = client.post("/api/auth/login", json={"login": "another", "password": "wrong-password"})
    assert resp.status_code == 429


def test_rate_limiter_forgets_old_addresses(monkeypatch):
    limiter = security.RateLimiter(limit=1, window=10)
    moment = [100.0]
    monkeypatch.setattr(security.time, "monotonic", lambda: moment[0])
    for i in range(1023):
        limiter.check(f"ip{i}")
    moment[0] += 60
    limiter.check("fresh")  # 1024-й вызов чистит устаревшие записи
    assert list(limiter._hits) == ["fresh"]
    with pytest.raises(HTTPException):
        limiter.check("fresh")


def test_session_cookie_flags(client):
    client.cookies.clear()
    resp = client.post("/api/auth/login", json={"login": "upk", "password": settings.demo_staff_password})
    cookie = resp.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie


def test_production_refuses_demo_settings(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PUBLIC_URL", "http://example.test")
    monkeypatch.setenv("SHOW_DEMO_LOGINS", "true")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    unsafe = Settings()
    assert len(unsafe.production_problems()) >= 4
    assert unsafe.enable_docs is False
    with pytest.raises(RuntimeError):
        unsafe.ensure_production_ready()


def test_production_starts_with_real_settings(monkeypatch):
    for name, value in {
        "APP_ENV": "production",
        "PUBLIC_URL": "https://upk.example.test",
        "SHOW_DEMO_LOGINS": "false",
        "SEED_DEMO": "false",
        "DEMO_ADMIN_PASSWORD": "a-long-unique-password-1",
        "DEMO_STAFF_PASSWORD": "a-long-unique-password-2",
        "DEMO_EXECUTOR_PASSWORD": "a-long-unique-password-3",
        "DATABASE_URL": "postgresql://upk:secret@db:5432/upk",
        "GIGACHAT_VERIFY_SSL": "true",
    }.items():
        monkeypatch.setenv(name, value)
    safe = Settings()
    assert safe.production_problems() == []
    assert safe.cookie_secure is True
    assert safe.database_url.startswith("postgresql+psycopg://")


@pytest.mark.parametrize(
    ("raw", "hidden"),
    [
        ("звоните 8 (928) 123-45-67 после обеда", "928"),
        ("мой телефон +7 928 123 45 67", "123"),
        ("пишите на ivanov.a@mail.ru", "ivanov"),
        ("карта 2200 1234 5678 9010", "5678"),
        ("пароль: Qwerty123", "Qwerty123"),
    ],
)
def test_personal_data_is_masked(raw, hidden):
    assert hidden not in mask_personal(raw)


def test_ordinary_text_stays_intact():
    for text in ("В кабинете 214 не работает проектор", "Какой пароль от wifi?", "Сломалось 3 стула из 12"):
        assert mask_personal(text) == text


def test_ai_log_does_not_store_personal_data(client):
    client.post("/api/assistant", json={"message": "Не работает проектор, мой телефон 89281234567"})
    with SessionLocal() as db:
        last = db.scalars(select(AiLog).order_by(AiLog.id.desc())).first()
    assert "89281234567" not in last.message


def test_retention_clears_old_personal_data(client):
    data = create_ticket(client, contact="@student")
    with SessionLocal() as db:
        ticket = db.get(Ticket, data["id"])
        long_ago = utcnow() - timedelta(days=settings.contact_retention_days + 1)
        ticket.status = "resolved"
        ticket.closed_at = long_ago
        changed_at = ticket.updated_at = long_ago
        db.add(
            AiLog(
                message="старое обращение",
                answer="старый ответ",
                kind="fault",
                engine="rules",
                created_at=utcnow() - timedelta(days=settings.ai_log_retention_days + 1),
            )
        )
        db.commit()
        log_id = db.scalars(select(AiLog.id).order_by(AiLog.id.desc())).first()

        purge(db)
        db.expire_all()
        ticket = db.get(Ticket, data["id"])
        assert ticket.contact is None
        assert ticket.updated_at == changed_at
        old_log = db.get(AiLog, log_id)
        assert old_log.message == "" and old_log.kind == "fault"


def test_tracking_code_does_not_reach_access_log():
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '%s "%s %s"',
        ("1.2.3.4", "GET", "/api/track/ABCD2345EFGH6789/qr.svg"),
        None,
    )
    HideTrackingCodes().filter(record)
    assert "ABCD2345EFGH6789" not in record.getMessage()


def test_ticket_list_has_no_query_per_row(client):
    login(client, "admin")
    statements = []

    def remember(_conn, _cursor, statement, *_rest):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", remember)
    try:
        resp = client.get("/api/staff/tickets?per_page=50")
    finally:
        event.remove(engine, "before_cursor_execute", remember)
    assert resp.status_code == 200 and len(resp.json()["items"]) >= 10
    assert len(statements) <= 12


def test_text_is_compressed_but_fonts_are_not(client):
    headers = {"accept-encoding": "gzip"}
    assert client.get("/static/js/core.js", headers=headers).headers.get("content-encoding") == "gzip"
    font = client.get("/static/fonts/inter-400-cyr.woff2", headers=headers).headers
    assert "content-encoding" not in font
    assert "immutable" in font["cache-control"]


def test_page_answers_304_when_unchanged(client):
    first = client.get("/")
    again = client.get("/", headers={"if-none-match": first.headers["etag"]})
    assert again.status_code == 304


def test_public_pages_are_indexable(client):
    for path in ("/", "/privacy"):
        resp = client.get(path)
        assert resp.status_code == 200
        assert "x-robots-tag" not in resp.headers


@pytest.mark.parametrize("path", ["/admin", "/track", "/t/ABCD2345EFGH6789", "/r/r214qa9f"])
def test_private_pages_are_hidden_from_search(client, path):
    assert "noindex" in client.get(path).headers["x-robots-tag"]


def test_seo_tags_use_public_url(client):
    html = client.get("/").text
    assert "%PUBLIC_URL%" not in html
    for tag in ('rel="canonical"', 'property="og:image"', "application/ld+json", 'name="description"'):
        assert tag in html
    # адрес не настроен, поэтому он берётся из запроса, а не остаётся localhost
    assert 'href="http://testserver/"' in html


def test_og_image_exists(client):
    resp = client.get("/static/img/og.png")
    assert resp.status_code == 200 and resp.headers["content-type"] == "image/png"


def test_robots_and_sitemap(client):
    robots = client.get("/robots.txt").text
    for rule in ("Disallow: /admin", "Disallow: /api/", "Disallow: /t/", "Sitemap:"):
        assert rule in robots
    sitemap = client.get("/sitemap.xml")
    assert sitemap.headers["content-type"].startswith("application/xml")
    assert f"<loc>{settings.public_url}/</loc>" in sitemap.text


def test_unknown_page_shows_404_page_and_api_stays_json(client):
    page = client.get("/no-such-page", headers=HTML)
    assert page.status_code == 404
    assert "Такой страницы нет" in page.text
    assert "noindex" in page.headers["x-robots-tag"]
    api = client.get("/api/no-such-endpoint", headers=HTML)
    assert api.status_code == 404
    assert api.headers["content-type"].startswith("application/json")


def test_health_reports_database(client):
    data = client.get("/api/health").json()
    assert data["status"] == "ok" and data["database"] is True


def test_models_match_migrations():
    # если поменять модель и забыть миграцию, этот тест упадёт
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert compare_metadata(context, Base.metadata) == []


def test_public_form_cannot_set_priority(client):
    from .conftest import login

    created = client.post(
        "/api/tickets", data={"description": "Не работает проектор", "location_note": "2 этаж", "priority": "critical"}
    )
    assert created.status_code == 201, created.text
    login(client)
    assert client.get(f"/api/staff/tickets/{created.json()['id']}").json()["priority"] != "critical"


def test_priority_comes_from_assistant_analysis(client):
    from .conftest import login

    message = "Не работает проектор, экран не включается"
    reply = client.post("/api/assistant", json={"message": message, "location_id": None, "context": []}).json()
    created = client.post(
        "/api/tickets",
        data={
            "description": message,
            "location_note": "2 этаж",
            "analysis_id": reply["analysis_id"],
            "priority": "low",
        },
    )
    assert created.status_code == 201, created.text
    login(client)
    assert client.get(f"/api/staff/tickets/{created.json()['id']}").json()["priority"] == reply["priority"]


def test_oversized_image_is_refused_before_unpacking():
    import io
    import warnings

    from PIL import Image

    from app.services.uploads import normalize_image

    buffer = io.BytesIO()
    Image.new("1", (7200, 7200)).save(buffer, "PNG")
    with warnings.catch_warnings(), pytest.raises(HTTPException) as refused:
        warnings.simplefilter("ignore")
        normalize_image(buffer.getvalue())
    assert refused.value.status_code == 400
