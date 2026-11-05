"""Проверки исправлений по итогам аудита."""

from datetime import timedelta

from app.ai import safety
from app.ai.text import extract_room, mask_personal
from app.config import settings
from app.db import SessionLocal
from app.models import Ticket, utcnow
from app.services.export import safe_cell
from app.services.retention import REMOVED_TEXT, purge


def _location_id(client) -> int:
    return client.get("/api/locations/qr/r214qa9f").json()["id"]


def _new_ticket(client, **fields) -> dict:
    data = {"description": "В кабинете не работает проектор", "location_id": _location_id(client), **fields}
    response = client.post("/api/tickets", data=data)
    assert response.status_code == 201
    return response.json()


def _login_staff(client) -> None:
    body = {"login": "upk", "password": settings.demo_staff_password}
    assert client.post("/api/auth/login", json=body).status_code == 200


def test_admin_password_is_not_public(client):
    logins = client.get("/api/meta").json()["demo_logins"]
    assert {item["login"] for item in logins} == {"upk", "electric"}


def test_broken_body_gives_422_without_raw_input(client):
    headers = {"content-type": "multipart/form-data; boundary=x"}
    response = client.post("/api/assistant", content=b"\xff\xfe--", headers=headers)
    assert response.status_code == 422
    assert all("input" not in err for err in response.json()["errors"])


def test_huge_number_is_not_a_server_error(client):
    assert client.get("/api/locations/99999999999999999999/status").status_code == 400


def test_export_does_not_run_formulas_and_uses_local_time(client):
    created = _new_ticket(client, title="=1+1", description="@SUM(A1) не работает проектор")
    assert safe_cell("=1+1") == "'=1+1"
    assert safe_cell("Не работает") == "Не работает"
    _login_staff(client)
    text = client.get("/api/staff/export.csv?status=").content.decode("utf-8")
    line = next(row for row in text.splitlines() if row.startswith(created["public_number"]))
    assert ";'=1+1;" in line
    local = utcnow() + timedelta(hours=settings.utc_offset_hours)
    assert local.strftime("%d.%m.%Y") in line


def test_join_counts_every_report(client):
    created = _new_ticket(client)
    number = int(created["public_number"].split("-")[1])
    for _ in range(3):
        assert client.post(f"/api/tickets/{number}/join", json={"location_id": _location_id(client)}).status_code == 200
    with SessionLocal() as db:
        assert db.get(Ticket, created["id"]).reports_count == 4


def test_old_closed_ticket_loses_its_text(client):
    created = _new_ticket(client, description="Личный текст заявки про проектор")
    with SessionLocal() as db:
        ticket = db.get(Ticket, created["id"])
        ticket.status = "resolved"
        ticket.closed_at = utcnow() - timedelta(days=settings.ticket_retention_days + 1)
        db.commit()
        purge(db)
    with SessionLocal() as db:
        assert db.get(Ticket, created["id"]).description == REMOVED_TEXT


def test_room_is_not_taken_from_time():
    assert extract_room("встретимся в 2 часа") is None
    assert extract_room("сломалось в 15 минут") is None
    assert extract_room("в кабинете 305 грязно") == "305"
    assert extract_room("не работает проектор в 214") == "214"


def test_personal_data_is_masked():
    assert "1234" not in mask_personal("паспорт 1234 567890")
    assert "12-34-56" not in mask_personal("мой телефон 12-34-56")
    assert "qwerty" not in mask_personal("пароль qwerty123")
    assert "Магомедович" not in mask_personal("Шамиль Магомедович сломал стул")
    assert mask_personal("какой пароль от wi-fi") == "какой пароль от wi-fi"


def test_electrical_danger_phrases():
    for text in ("пахнет паленым", "из розетки пахнет жженым", "замыкание в проводке"):
        assert safety.detect(text) == safety.DANGER


def test_model_cannot_promise_deadlines_or_invent_people():
    assert safety.promises_deadline("Починят в течение 2 дней")
    assert safety.invents_person("Позвоните Шамилю Алиеву")
    assert not safety.invents_person("Обратитесь к сотруднику УПК")
    assert safety.is_unsafe_advice("Откройте крышку проектора")


def _ask(client, message, context=()):
    body = {"message": message, "location_id": _location_id(client), "context": list(context)}
    response = client.post("/api/assistant", json=body)
    assert response.status_code == 200
    return response.json()


def test_unwell_gets_a_clear_answer_without_a_ticket(client):
    for text in ("Я умираю", "Мне плохо я умираю"):
        reply = _ask(client, text)
        assert reply["guard"] == "unwell"
        assert "112" in reply["answer"]
        assert not reply["suggest_ticket"]


def test_unrelated_messages_stay_out_of_the_ticket(client):
    reply = _ask(client, "проектор", ["Я умираю", "Мне плохо я умираю"])
    assert reply["kind"] == "fault"
    assert "умираю" not in reply["draft_title"].lower()
    assert "умираю" not in reply["draft_description"].lower()


def test_details_from_earlier_messages_are_kept(client):
    reply = _ask(client, "в кабинете 305", ["Сломался стул"])
    assert reply["kind"] == "fault"
    assert "стул" in reply["draft_description"].lower()
    assert reply["room_hint"] == "305"


def test_second_unclear_answer_differs(client):
    first = _ask(client, "ну вот так")
    second = _ask(client, "ну вот так", ["ну вот так"])
    assert first["kind"] == second["kind"] == "unclear"
    assert first["answer"] != second["answer"]
