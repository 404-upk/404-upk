"""Окружение Alembic. Подключение приходит из приложения (при старте) или создаётся по настройкам (из командной строки)."""

from alembic import context

from app import models  # noqa: F401  регистрирует таблицы
from app.db import Base, engine

target_metadata = Base.metadata


def run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite не умеет менять столбцы напрямую
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    with engine.connect() as own_connection:
        run(own_connection)
