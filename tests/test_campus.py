from .conftest import create_ticket, location_id


def test_campus_summary_counts_clear_rooms(client):
    campus = client.get("/api/campus").json()
    assert campus["rooms_total"] > 0
    assert 0 <= campus["rooms_clear"] <= campus["rooms_total"]
    assert campus["state"] in {"calm", "busy", "heavy"}
    rooms = [r for b in campus["buildings"] for r in b["rooms"]]
    assert len(rooms) == campus["rooms_total"]
    assert {r["state"] for r in rooms} <= {"clear", "open", "urgent"}


def test_room_status_shows_open_ticket(client):
    loc = location_id(client)
    create_ticket(client)
    room = client.get(f"/api/locations/{loc}/status").json()
    assert room["state"] in {"open", "urgent"}
    assert room["open"] >= 1
    issue = room["issues"][0]
    # публично отдаём только заголовок и статус, без описания
    assert "description" not in issue
    assert {"number", "title", "status_label"} <= set(issue)


def test_room_status_unknown_location(client):
    assert client.get("/api/locations/999999/status").status_code == 404
