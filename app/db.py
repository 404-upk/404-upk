from collections.abc import Iterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, create_engine, event, func, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
# база, созданная до появления миграций, соответствует этой ревизии
BASELINE_REVISION = "0001"

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    **({} if _is_sqlite else {"pool_pre_ping": True, "pool_size": 10, "max_overflow": 20, "pool_recycle": 1800}),
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()
        # встроенный lower() в SQLite не понимает кириллицу, поэтому поиск идёт через свою функцию
        dbapi_conn.create_function("py_lower", 1, lambda s: s.lower() if isinstance(s, str) else s, deterministic=True)


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def lower(column):
    return func.py_lower(column) if _is_sqlite else func.lower(column)


class Base(DeclarativeBase):
    # с именами ограничений миграции одинаково работают на SQLite и PostgreSQL
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def alembic_config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    return config


def run_migrations() -> None:
    """Приводит схему к последней версии. База без истории миграций считается базой первой версии."""
    from . import models  # noqa: F401  регистрирует таблицы

    config = alembic_config()
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            # несколько процессов могут стартовать одновременно, миграции выполняет один
            connection.execute(text("SELECT pg_advisory_xact_lock(404404)"))
        config.attributes["connection"] = connection
        tables = inspect(connection).get_table_names()
        if "users" in tables and "alembic_version" not in tables:
            command.stamp(config, BASELINE_REVISION)
        command.upgrade(config, "head")


def init_db() -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    run_migrations()


def reset_db() -> None:
    """Удаляет все таблицы вместе с историей миграций."""
    from . import models  # noqa: F401  регистрирует таблицы

    Base.metadata.drop_all(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))
