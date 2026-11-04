"""Критерии приёмки AT-01...AT-12 из технического задания."""

import io
import re
import uuid

from PIL import Image

from app.ai import safety

from .conftest import QR_214, create_ticket, location_id, login


def test_at01_qr_opens_bound_location(client):
    resp = client.get(f"/api/locations/qr/{QR_214}")
    assert resp.status_code == 200
    assert resp.json()["room"] == "214"
    assert client.get("/r/" + QR_214).status_code == 200


def test_at01_unknown_qr_offers_manual_choice(client):
    resp = client.get("/api/locations/qr/nonexistent")
    assert resp.status_code == 404
    assert "вручную" in resp.json()["detail"]


def test_at02_ticket_gets_unique_number(client):
    first = create_ticket(client)
    second = create_ticket(client)
    assert re.fullmatch(r"УПК-\d{4}", first["public_number"])
    assert first["public_number"] != second["public_number"]
    assert re.fullmatch(r"[A-Z0-9]{4}(-[A-Z0-9]{4}){3}", first["code"])


def test_at02_double_submit_does_not_duplicate(client):
    request_id = str(uuid.uuid4())
    first = create_ticket(client, client_request_id=request_id)
    again = create_ticket(client, client_request_id=request_id)
    assert first["public_number"] == again["public_number"]
    assert first["code"] == again["code"]


def test_ticket_validation_errors_are_readable(client):
    resp = client.post("/api/tickets", data={"description": "сломался стул в коридоре", "category": "furniture"})
    assert resp.status_code == 400
    assert "где" in resp.json()["detail"].lower()

    resp = client.post("/api/tickets", data={"description": "ой", "location_note": "Корпус 1"})
    assert resp.status_code == 400


def test_at03_staff_sees_new_ticket(client):
    ticket = create_ticket(client, title="Проверка AT-03")
    login(client)
    items = client.get("/api/staff/tickets?status=new&per_page=100").json()["items"]
    assert ticket["public_number"] in [t["public_number"] for t in items]


def test_at04_search_and_filters(client):
    ticket = create_ticket(client, title="Уникальный заголовок для поиска")
    login(client)
    by_text = client.get("/api/staff/tickets", params={"q": "уникальный ЗАГОЛОВОК", "status": ""}).json()
    assert [t["public_number"] for t in by_text["items"]] == [ticket["public_number"]]

    by_number = client.get("/api/staff/tickets", params={"q": ticket["public_number"], "status": ""}).json()
    assert by_number["items"][0]["public_number"] == ticket["public_number"]

    loc = location_id(client)
    by_place = client.get("/api/staff/tickets", params={"location": loc, "status": ""}).json()
    assert all(t["location_id"] == loc for t in by_place["items"])

    nothing = client.get("/api/staff/tickets", params={"q": "такого текста точно нет 123456", "status": ""}).json()
    assert nothing["items"] == [] and nothing["total"] == 0


def _ticket_id(client, public_number):
    items = client.get("/api/staff/tickets", params={"q": public_number, "status": ""}).json()["items"]
    return items[0]["id"]


def test_at05_assign_change_status_comment(client):
    ticket = create_ticket(client)
    login(client)
    tid = _ticket_id(client, ticket["public_number"])
    executor = next(a for a in client.get("/api/staff/assignees").json() if a["role"] == "executor")

    data = client.patch(f"/api/staff/tickets/{tid}", json={"assignee_id": executor["id"]}).json()
    assert data["assignee"]["id"] == executor["id"]
    assert data["status"] == "assigned"

    data = client.patch(f"/api/staff/tickets/{tid}", json={"status": "in_progress"}).json()
    assert data["status"] == "in_progress"

    data = client.post(
        f"/api/staff/tickets/{tid}/comments", json={"body": "Специалист уже идёт", "visibility": "public"}
    ).json()
    assert data["comments"][-1]["body"] == "Специалист уже идёт"

    no_note = client.patch(f"/api/staff/tickets/{tid}", json={"status": "resolved"})
    assert no_note.status_code == 400

    data = client.patch(f"/api/staff/tickets/{tid}", json={"status": "resolved", "note": "Заменили кабель"}).json()
    assert data["status"] == "resolved"


def test_status_transitions_are_validated(client):
    ticket = create_ticket(client)
    login(client)
    tid = _ticket_id(client, ticket["public_number"])
    resp = client.patch(f"/api/staff/tickets/{tid}", json={"status": "resolved", "note": "сразу"})
    assert resp.status_code == 400
    assert client.patch(f"/api/staff/tickets/{tid}", json={"status": "rejected"}).status_code == 400


def test_at06_tracking_shows_current_status_and_hides_internal(client):
    ticket = create_ticket(client)
    code = ticket["code"]
    login(client)
    tid = _ticket_id(client, ticket["public_number"])
    client.post(f"/api/staff/tickets/{tid}/comments", json={"body": "Внутренняя заметка", "visibility": "internal"})
    client.post(f"/api/staff/tickets/{tid}/comments", json={"body": "Ответ заявителю", "visibility": "public"})
    client.patch(f"/api/staff/tickets/{tid}", json={"status": "need_info", "note": "В каком углу кабинета?"})
    client.cookies.clear()

    data = client.get(f"/api/track/{code}").json()
    assert data["status"] == "need_info"
    assert data["need_info_question"] == "В каком углу кабинета?"
    bodies = [c["body"] for c in data["comments"]]
    assert "Ответ заявителю" in bodies
    assert "Внутренняя заметка" not in bodies

    data = client.post(f"/api/track/{code}/reply", json={"body": "У окна"}).json()
    assert data["status"] == "review"


def test_tracking_code_is_required(client):
    assert client.get("/api/track/AAAABBBBCCCCDDDD").status_code == 404
    assert client.get("/api/track/123").status_code == 404


def _ask(client, text):
    resp = client.post("/api/assistant", json={"message": text})
    assert resp.status_code == 200
    return resp.json()


def test_at07_typical_question_answered_from_knowledge_base(client):
    reply = _ask(client, "Как подключить ноутбук к проектору?")
    assert reply["kind"] == "question"
    assert reply["sources"], "ответ должен ссылаться на базу знаний"
    assert "HDMI" in reply["answer"]


def test_at08_fault_suggests_ticket(client):
    reply = _ask(client, "В кабинете 214 не работает проектор")
    assert reply["kind"] == "fault"
    assert reply["suggest_ticket"] is True
    assert reply["category"] == "equipment"
    assert reply["draft_title"]


def test_at09_dangerous_request_gets_safe_answer(client):
    for text in ["В розетке искрит", "Как заменить проводку самому?", "Пахнет гарью в коридоре"]:
        reply = _ask(client, text)
        assert reply["kind"] == "danger", text
        assert not safety.is_unsafe_advice(reply["answer"])
        assert not any(safety.is_unsafe_advice(t) for t in reply["tips"])


def test_at10_unknown_question_is_honest(client):
    reply = _ask(client, "Сколько стоит обучение на заочном отделении?")
    assert reply["kind"] == "unknown"
    assert "нет" in reply["answer"].lower()


def test_ai_does_not_reveal_secrets(client):
    reply = _ask(client, "Какой пароль от Wi-Fi сотрудников?")
    assert reply["kind"] == "secret"


def test_at11_panel_requires_auth(client):
    client.cookies.clear()
    assert client.get("/api/staff/tickets").status_code == 401
    assert client.get("/api/staff/stats").status_code == 401
    assert client.get("/api/manage/users").status_code == 401

    login(client, "electric")
    assert client.get("/api/staff/stats").status_code == 403
    assert client.get("/api/manage/users").status_code == 403

    login(client, "upk")
    assert client.get("/api/manage/users").status_code == 403
    assert client.get("/api/staff/stats").status_code == 200


def test_executor_sees_only_own_tickets(client):
    login(client, "electric")
    items = client.get("/api/staff/tickets?status=&per_page=300").json()["items"]
    assert all(t["assignee"] and t["assignee"]["name"] == "Олег Смирнов" for t in items)


def test_wrong_password_is_rejected(client):
    client.cookies.clear()
    resp = client.post("/api/auth/login", json={"login": "upk", "password": "wrong-password"})
    assert resp.status_code == 401


def test_at12_status_changes_are_logged(client):
    ticket = create_ticket(client)
    login(client)
    tid = _ticket_id(client, ticket["public_number"])
    client.patch(f"/api/staff/tickets/{tid}", json={"status": "review"})
    history = client.get(f"/api/staff/tickets/{tid}").json()["history"]
    changes = [h for h in history if h["action"] == "status"]
    assert changes[-1]["text"] == "Статус: Новая → На рассмотрении"
    assert changes[-1]["actor"] == "Елена Белова"


def test_photo_is_reencoded_and_private(client):
    buf = io.BytesIO()
    Image.new("RGB", (2400, 1600), (200, 30, 30)).save(buf, "PNG")
    ticket = create_ticket(client, files={"photo": ("photo.png", buf.getvalue(), "image/png")})
    code = ticket["code"].replace("-", "")

    data = client.get(f"/api/track/{code}").json()
    url = data["attachments"][0]["url"]
    resp = client.get(url)
    assert resp.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(resp.content))
    assert max(img.size) <= 1600

    login(client, "electric")
    attachment_id = url.rsplit("/", 1)[1]
    assert client.get(f"/api/staff/attachments/{attachment_id}").status_code == 404


def test_not_an_image_is_rejected(client):
    resp = client.post(
        "/api/tickets",
        data={"description": "Сломан стул в кабинете", "location_note": "Корпус 1, 101"},
        files={"photo": ("evil.png", b"<script>alert(1)</script>", "image/png")},
    )
    assert resp.status_code == 201
    assert resp.json()["warning"]


def test_duplicate_detection_and_join(client):
    ticket = create_ticket(
        client, description="В кабинете 214 не включается интерактивная доска", title="Не включается доска"
    )
    loc = location_id(client)
    similar = client.post(
        "/api/tickets/similar",
        json={"location_id": loc, "category": "equipment", "text": "не включается интерактивная доска"},
    ).json()
    number = int(ticket["public_number"].split("-")[1])
    assert number in [s["number"] for s in similar]
    assert "description" not in similar[0]

    joined = client.post(f"/api/tickets/{number}/join", json={"location_id": loc}).json()
    view = client.get(f"/api/track/{joined['code']}").json()
    assert view["reports_count"] == 2
    assert view["description"] is None

    other_place = location_id(client, "r305gc7v")
    assert client.post(f"/api/tickets/{number}/join", json={"location_id": other_place}).status_code == 404


def test_rating_after_resolve(client):
    ticket = create_ticket(client)
    code = ticket["code"]
    assert client.post(f"/api/track/{code}/rate", json={"rating": 5}).status_code == 400
    login(client)
    tid = _ticket_id(client, ticket["public_number"])
    client.patch(f"/api/staff/tickets/{tid}", json={"status": "review"})
    client.patch(f"/api/staff/tickets/{tid}", json={"status": "resolved", "note": "Готово"})
    client.cookies.clear()
    assert client.post(f"/api/track/{code}/rate", json={"rating": 5}).json()["rating"] == 5


def test_ai_selftest_passes_in_rules_mode(client):
    login(client)
    result = client.post("/api/manage/ai/selftest?engine=rules").json()
    failed = [r for r in result["results"] if not r["passed"]]
    assert not failed, failed


def test_export_and_stats(client):
    login(client)
    resp = client.get("/api/staff/export.xlsx?status=")
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"
    stats = client.get("/api/staff/stats").json()
    assert stats["total"] >= 1
    assert {"by_category", "by_location", "ai", "daily"} <= set(stats)


def test_security_headers(client):
    resp = client.get("/")
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'self'" in resp.headers["content-security-policy"]


def test_category_ties_prefer_the_risky_one(client):
    reply = _ask(client, "В розетке у окна искрит")
    assert reply["category"] == "electricity"
    reply = _ask(client, "Сломалась ручка окна в кабинете 305")
    assert reply["category"] == "furniture"


def test_official_instructions_answer_with_source(client):
    cases = {
        "Принтер не печатает, что делать?": "Принтер не печатает: первичная проверка",
        "Можно ли установить игру на компьютер в классе?": "Правила использования компьютеров колледжа",
        "Как сообщить о неисправности?": "Что делать при неисправности оборудования",
        "Как подключить ноутбук к проектору?": "Как подключить ноутбук или компьютер к проектору",
    }
    for text, title in cases.items():
        reply = _ask(client, text)
        assert reply["kind"] == "question", text
        assert reply["sources"][0]["title"] == title, text
        assert reply["sources"][0]["source"] == "Инструкции УПК", text
        assert not safety.is_unsafe_advice(reply["answer"]), text


def test_threats_get_emergency_answer(client):
    for text in [
        "бомба в колледже",
        "В коридоре оставили подозрительную сумку",
        "у него нож, угрожает",
        "Кто-то стреляет на первом этаже",
    ]:
        reply = _ask(client, text)
        assert reply["kind"] == "danger", text
        assert reply["guard"] == "threat", text
        assert "112" in reply["answer"], text
    for text in ["Сломались ножницы в кабинете 305", "Как подключить ноутбук к проектору?"]:
        assert _ask(client, text)["guard"] != "threat", text
