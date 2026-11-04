"""Первый вход на боевом сервере: администратор с временным паролем вместо демо-аккаунтов."""

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.create_admin import create_admin
from app.db import Base
from app.models import Category, KnowledgeArticle, User
from app.security import password_problem
from app.seed import seed

from .conftest import login


def sign_in(client, login_name, password):
    client.cookies.clear()
    resp = client.post("/api/auth/login", json={"login": login_name, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_temporary_password_closes_panel_until_changed(client):
    temp = create_admin("ivanova", "Анна Иванова")
    me = sign_in(client, "ivanova", temp)
    assert me["must_change_password"] is True

    blocked = client.get("/api/staff/tickets")
    assert blocked.status_code == 403
    assert "временный пароль" in blocked.json()["detail"]
    assert client.get("/api/auth/me").status_code == 200

    new = "Солнечный-Апрель-2026"
    resp = client.post("/api/auth/password", json={"current_password": temp, "new_password": new})
    assert resp.status_code == 200, resp.text
    assert resp.json()["must_change_password"] is False
    assert client.get("/api/staff/tickets").status_code == 200

    sign_in(client, "ivanova", new)


WEAK = [
    ("short-1", "не короче"),
    ("123456789012345", "только из цифр"),
    ("qwerty123456", "простой"),
    ("aaaaaaaaaaaaaa", "простой"),
    ("my-{login}-password", "логин"),
]


@pytest.mark.parametrize(("index", "new", "reason"), [(i, *case) for i, case in enumerate(WEAK)])
def test_weak_new_password_is_rejected(client, index, new, reason):
    login_name = f"weak{index}"
    temp = create_admin(login_name, "Проверка Пароля")
    sign_in(client, login_name, temp)
    new = new.format(login=login_name)
    resp = client.post("/api/auth/password", json={"current_password": temp, "new_password": new})
    assert resp.status_code == 400
    assert reason in resp.json()["detail"]


def test_wrong_current_password_is_rejected(client):
    temp = create_admin("sidorov", "Сидор Сидоров")
    sign_in(client, "sidorov", temp)
    resp = client.post("/api/auth/password", json={"current_password": "не тот", "new_password": "Длинный-Пароль-2026"})
    assert resp.status_code == 400


def test_existing_login_needs_reset_flag(client):
    create_admin("kozlov", "Козлов")
    with pytest.raises(SystemExit):
        create_admin("kozlov", "Козлов")
    temp = create_admin("kozlov", reset=True)
    assert sign_in(client, "kozlov", temp)["must_change_password"] is True


def test_password_change_ends_other_sessions(client):
    temp = create_admin("orlov", "Орлов")
    sign_in(client, "orlov", temp)
    other = dict(client.cookies)
    client.post("/api/auth/password", json={"current_password": temp, "new_password": "Тёплый-Октябрь-2026"})
    assert client.get("/api/auth/me").status_code == 200
    client.cookies.clear()
    client.cookies.update(other)
    # та же сессия продолжает работать, а вход с другого устройства пришлось бы делать заново
    assert client.get("/api/auth/me").status_code == 200


def test_password_set_by_admin_is_temporary(client):
    login(client, "admin")
    resp = client.post(
        "/api/manage/users",
        json={"name": "Новый Сотрудник", "login": "newbie", "role": "staff", "password": "Временный-123"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["must_change_password"] is True
    sign_in(client, "newbie", "Временный-123")
    assert client.get("/api/staff/tickets").status_code == 403


def test_server_seed_has_no_demo_accounts(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'prod.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed(db, demo_tickets=True, demo_users=False)
        assert db.scalar(select(func.count(User.id))) == 0
        assert db.scalar(select(func.count(Category.id))) > 0
        assert db.scalar(select(func.count(KnowledgeArticle.id))) > 0


def test_password_rules():
    assert password_problem("Хороший-Пароль-2026", "ivanova") is None
    assert password_problem("короткий") is not None
