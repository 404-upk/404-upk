"""Браузерные тесты: настоящий сайт в отдельном процессе и Chromium через Playwright.

Запуск: pip install -r requirements-e2e.txt && python -m playwright install chromium && python -m pytest tests/e2e
Без установленного Playwright тесты пропускаются, обычный `pytest` их не требует.
"""

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api", reason="браузерные тесты: pip install -r requirements-e2e.txt")

ROOT = Path(__file__).resolve().parents[2]
ADMIN = ("admin", "upk-admin-2026")
QR_214 = "r214qa9f"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def base_url():
    """Сайт с чистой демо-базой на свободном порту, на всё время тестов."""
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    env = {
        **os.environ,
        "DATA_DIR": tempfile.mkdtemp(prefix="upk-e2e-"),
        "DATABASE_URL": "",
        "PUBLIC_URL": url,
        "GIGACHAT_AUTH_KEY": "",
        "TELEGRAM_BOT_TOKEN": "",
        "SEED_DEMO": "true",
    }
    log = open(Path(env["DATA_DIR"]) / "server.log", "wb")  # noqa: SIM115 — живёт до конца тестов
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 40
    while True:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    break
        except OSError:
            pass
        if proc.poll() is not None or time.monotonic() > deadline:
            proc.kill()
            log.close()
            pytest.fail(
                "сайт для браузерных тестов не запустился:\n" + (Path(env["DATA_DIR"]) / "server.log").read_text()
            )
        time.sleep(0.3)
    yield url
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()


@pytest.fixture(scope="module")
def browser():
    # браузер закрывается после файла с браузерными тестами: Playwright держит свой цикл событий,
    # и остальные тесты в том же прогоне (asyncio.run) не должны его застать
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _context(browser, base_url, **kwargs):
    # интро показывается один раз за сессию, в тестах оно не нужно; анимации сокращены
    ctx = browser.new_context(base_url=base_url, reduced_motion="reduce", **kwargs)
    ctx.add_init_script("try { sessionStorage.setItem('upk-intro', '1') } catch (e) {}")
    ctx.set_default_timeout(15000)
    return ctx


@pytest.fixture
def page(browser, base_url):
    ctx = _context(browser, base_url, viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    yield pg
    ctx.close()
    assert not errors, f"ошибки JavaScript на странице: {errors}"


@pytest.fixture
def phone(browser, base_url):
    ctx = _context(browser, base_url, viewport={"width": 360, "height": 740}, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    yield pg
    ctx.close()


def create_ticket(page, title: str, qr_key: str = QR_214, category: str = "equipment") -> dict:
    """Заявка через API от имени заявителя: для сценариев панели нужна свежая заявка в статусе «Новая»."""
    loc = page.request.get(f"/api/locations/qr/{qr_key}").json()
    resp = page.request.post(
        "/api/tickets",
        multipart={
            "title": title,
            "description": f"{title}. Проверка браузерными тестами.",
            "category": category,
            "location_id": str(loc["id"]),
            "client_request_id": str(uuid.uuid4()),
            "source": "manual",
        },
    )
    assert resp.ok, resp.text()
    return resp.json()


def submit_admin_login(page):
    page.fill("#l-nick", ADMIN[0])
    page.fill("#l-secret", ADMIN[1])
    page.keyboard.press("Enter")
    page.locator(".nav a").first.wait_for()


_admin_cookies: list[dict] = []


def login_admin(page):
    """Вход в панель. Сессия переиспользуется: сервер разрешает 10 входов одного логина за 5 минут."""
    if _admin_cookies:
        page.context.add_cookies(_admin_cookies)
    page.goto("/admin")
    page.locator(".nav a, #l-nick").first.wait_for()
    if page.locator("#l-nick").count():
        submit_admin_login(page)
        _admin_cookies[:] = page.context.cookies()
