import os
import tempfile

# база и настройки для тестов задаются до импорта приложения
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="upk-test-")
os.environ["GIGACHAT_AUTH_KEY"] = ""
os.environ["TELEGRAM_BOT_TOKEN"] = ""
os.environ["SEED_DEMO"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import security  # noqa: E402
from app.ai import resilience  # noqa: E402
from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

QR_214 = "r214qa9f"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_limits():
    for limiter in (
        security.login_limiter,
        security.login_ip_limiter,
        security.lookup_limiter,
        security.assistant_limiter,
        security.ticket_limiter,
        security.track_limiter,
    ):
        limiter.reset()
    resilience.breaker.reset()
    resilience.cache.clear()


def login(client: TestClient, user: str = "upk") -> TestClient:
    passwords = {
        "admin": settings.demo_admin_password,
        "upk": settings.demo_staff_password,
    }
    password = passwords.get(user, settings.demo_executor_password)
    client.cookies.clear()
    resp = client.post("/api/auth/login", json={"login": user, "password": password})
    assert resp.status_code == 200, resp.text
    return client


def location_id(client: TestClient, qr_key: str = QR_214) -> int:
    return client.get(f"/api/locations/qr/{qr_key}").json()["id"]


def create_ticket(client: TestClient, **fields) -> dict:
    data = {
        "description": "В кабинете 214 не работает проектор",
        "title": "Не работает проектор",
        "category": "equipment",
        "location_id": str(location_id(client)),
        "source": "qr",
    }
    data.update({k: str(v) for k, v in fields.items() if k != "files"})
    resp = client.post("/api/tickets", data=data, files=fields.get("files"))
    assert resp.status_code == 201, resp.text
    return resp.json()
