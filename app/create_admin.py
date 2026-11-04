"""Первый администратор на сервере без демо-паролей.

    python -m app.create_admin --login ivanova --name "Анна Иванова"
    python -m app.create_admin --login ivanova --reset      (выдать новый временный пароль)

Команда печатает временный пароль один раз. При первом входе его нужно сменить, до этого панель закрыта.
"""

import argparse
import sys

from sqlalchemy import delete, select

from .db import SessionLocal, init_db
from .models import ROLE_ADMIN, ROLES, User, UserSession
from .security import hash_password, temporary_password


def create_admin(login: str, name: str | None = None, role: str = ROLE_ADMIN, reset: bool = False) -> str:
    login = login.strip().lower()
    password = temporary_password()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.login == login))
        if user and not reset:
            raise SystemExit(f"Логин {login} уже занят. Чтобы выдать новый временный пароль, добавьте --reset")
        if not user:
            if not name:
                raise SystemExit('Укажите имя: --name "Имя Фамилия"')
            user = User(login=login, name=name.strip(), role=role, password_hash="")
            db.add(user)
        user.password_hash = hash_password(password)
        user.must_change_password = True
        user.is_active = True
        db.flush()
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.commit()
    return password


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Создать сотрудника с временным паролем")
    parser.add_argument("--login", required=True)
    parser.add_argument("--name")
    parser.add_argument("--role", default=ROLE_ADMIN, choices=list(ROLES))
    parser.add_argument("--reset", action="store_true", help="выдать новый временный пароль существующему сотруднику")
    args = parser.parse_args(argv)

    init_db()
    password = create_admin(args.login, args.name, args.role, args.reset)
    print(f"Логин: {args.login.strip().lower()}")
    print(f"Временный пароль: {password}")
    print("Пароль показывается один раз. При первом входе панель попросит заменить его своим.")


if __name__ == "__main__":
    main(sys.argv[1:])
