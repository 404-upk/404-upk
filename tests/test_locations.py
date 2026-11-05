"""Помещения и QR-коды: добавление, дубли и скачивание кода, когда в номере кабинета кириллица."""

from .conftest import login


def _room(**changes) -> dict:
    return {
        "building": "Корпус 1",
        "floor": 9,
        "room": "214а",
        "zone_name": None,
        "kind": "room",
        "is_active": True,
        **changes,
    }


def test_room_with_cyrillic_number_gets_downloadable_qr(client):
    login(client)
    created = client.post("/api/manage/locations", json=_room())
    assert created.status_code == 201, created.text
    png = client.get(f"/api/manage/locations/{created.json()['id']}/qr.png")
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"
    assert "filename*=UTF-8''qr-214%D0%B0.png" in png.headers["content-disposition"]


def test_same_room_is_not_added_twice(client):
    login(client)
    assert client.post("/api/manage/locations", json=_room(room="901")).status_code == 201
    again = client.post("/api/manage/locations", json=_room(room=" 901 "))
    assert again.status_code == 400
    assert again.json()["detail"] == "Такое помещение уже есть в списке"
    assert client.post("/api/manage/locations", json=_room(room="901", floor=8)).status_code == 201


def test_room_needs_building_and_name(client):
    login(client)
    assert client.post("/api/manage/locations", json=_room(building="   ")).status_code == 400
    assert client.post("/api/manage/locations", json=_room(room="  ")).status_code == 400
