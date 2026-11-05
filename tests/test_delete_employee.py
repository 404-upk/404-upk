"""Удаление сотрудников и помещений: права, судьба заявок и истории."""

import uuid

from .conftest import create_ticket, location_id, login

PASSWORD = "temp-password-1"


def _new_user(client, role="executor") -> dict:
    # база общая на все тесты, поэтому логин каждый раз новый
    login_name = f"temp.{uuid.uuid4().hex[:10]}"
    body = {"name": "Временный Сотрудник", "login": login_name, "role": role, "password": PASSWORD}
    resp = client.post("/api/manage/users", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _ticket_id(client, public_number) -> int:
    return client.get("/api/staff/tickets", params={"q": public_number, "status": ""}).json()["items"][0]["id"]


def test_deleting_employee_returns_open_tickets_and_keeps_history(client):
    ticket = create_ticket(client)
    closed_ticket = create_ticket(client, title="Заявка, которую он закрыл")
    login(client, "admin")
    user = _new_user(client)
    tid = _ticket_id(client, ticket["public_number"])
    closed = _ticket_id(client, closed_ticket["public_number"])

    assert client.patch(f"/api/staff/tickets/{tid}", json={"assignee_id": user["id"]}).status_code == 200
    assert client.patch(f"/api/staff/tickets/{tid}", json={"status": "in_progress"}).status_code == 200
    assert client.patch(f"/api/staff/tickets/{closed}", json={"assignee_id": user["id"]}).status_code == 200
    assert client.patch(f"/api/staff/tickets/{closed}", json={"status": "in_progress"}).status_code == 200
    resolved = client.patch(f"/api/staff/tickets/{closed}", json={"status": "resolved", "note": "Готово"})
    assert resolved.status_code == 200, resolved.text

    listed = next(u for u in client.get("/api/manage/users").json() if u["id"] == user["id"])
    assert listed["open_tickets"] == 1

    # сотрудник вошёл, его сессия должна закончиться вместе с учётной записью
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"login": user["login"], "password": PASSWORD}).status_code == 200
    worker_cookies = dict(client.cookies)
    login(client, "admin")

    deleted = client.delete(f"/api/manage/users/{user['id']}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["released"] == 1

    data = client.get(f"/api/staff/tickets/{tid}").json()
    assert data["assignee"] is None
    assert data["status"] == "review"
    assert any("Временный Сотрудник" in str(h) for h in data["history"])

    old = client.get(f"/api/staff/tickets/{closed}").json()
    assert old["status"] == "resolved"
    assert old["assignee"] is None

    assert all(u["id"] != user["id"] for u in client.get("/api/manage/users").json())
    assert client.delete(f"/api/manage/users/{user['id']}").status_code == 404

    client.cookies.clear()
    client.cookies.update(worker_cookies)
    assert client.get("/api/staff/tickets").status_code == 401
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"login": user["login"], "password": PASSWORD}).status_code == 401


def test_default_assignee_is_cleared_with_employee(client):
    login(client, "admin")
    user = _new_user(client)
    category = client.get("/api/manage/categories").json()[0]
    client.patch(f"/api/manage/categories/{category['id']}", json={"default_assignee_id": user["id"]})
    assert client.delete(f"/api/manage/users/{user['id']}").status_code == 200
    again = next(c for c in client.get("/api/manage/categories").json() if c["id"] == category["id"])
    assert again["default_assignee"] is None


def test_admin_cannot_delete_self(client):
    login(client, "admin")
    me = next(u for u in client.get("/api/manage/users").json() if u["login"] == "admin")
    resp = client.delete(f"/api/manage/users/{me['id']}")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Нельзя удалить самого себя"


def test_only_admin_deletes_employees(client):
    login(client, "admin")
    user = _new_user(client)
    login(client, "upk")
    assert client.delete(f"/api/manage/users/{user['id']}").status_code == 403
    client.cookies.clear()
    assert client.delete(f"/api/manage/users/{user['id']}").status_code == 401


def test_room_with_tickets_is_not_deleted(client):
    create_ticket(client)
    login(client)
    with_tickets = location_id(client)
    resp = client.delete(f"/api/manage/locations/{with_tickets}")
    assert resp.status_code == 400
    assert "только отключить" in resp.json()["detail"]

    room = {"building": "Корпус 1", "floor": 9, "room": "950", "kind": "room", "is_active": True}
    created = client.post("/api/manage/locations", json=room).json()
    assert client.delete(f"/api/manage/locations/{created['id']}").status_code == 200
    assert client.delete(f"/api/manage/locations/{created['id']}").status_code == 404


def test_ticket_list_tells_allowed_transitions(client):
    create_ticket(client)
    login(client)
    item = client.get("/api/staff/tickets", params={"status": "new"}).json()["items"][0]
    assert {"value": "review", "label": "На рассмотрении"} in item["transitions"]
