import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"

load_dotenv(BASE_DIR / ".env")

DEFAULT_DEMO_PASSWORDS = {"upk-admin-2026", "upk-staff-2026", "upk-exec-2026"}


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _env_path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    path = Path(value) if value else default
    return path if path.is_absolute() else BASE_DIR / path


def _database_url(default: str) -> str:
    url = os.getenv("DATABASE_URL") or default
    # драйвер PostgreSQL в проекте один, адрес можно указывать в обычном виде
    return url.replace("postgresql://", "postgresql+psycopg://", 1) if url.startswith("postgresql://") else url


class Settings:
    def __init__(self) -> None:
        self.app_env = os.getenv("APP_ENV", "development").strip().lower()

        data_dir = _env_path("DATA_DIR", BASE_DIR / "data")
        self.data_dir = data_dir
        self.database_url = _database_url(f"sqlite:///{(data_dir / 'upk.db').as_posix()}")
        self.upload_dir = _env_path("UPLOAD_DIR", data_dir / "uploads")
        self.public_url = os.getenv("PUBLIC_URL", "http://localhost:8000").rstrip("/")
        self.enable_docs = _env_bool("ENABLE_DOCS", not self.is_production)

        self.session_ttl_hours = int(os.getenv("SESSION_TTL_HOURS", "12"))
        self.cookie_secure = _env_bool("COOKIE_SECURE", self.public_url.startswith("https://"))
        self.trust_proxy = _env_bool("TRUST_PROXY")
        self.max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "8"))

        # сколько дней хранить тексты обращений к ИИ и контакты заявителей после закрытия заявки; 0 — не удалять
        self.ai_log_retention_days = int(os.getenv("AI_LOG_RETENTION_DAYS", "90"))
        self.contact_retention_days = int(os.getenv("CONTACT_RETENTION_DAYS", "90"))

        self.gigachat_auth_key = os.getenv("GIGACHAT_AUTH_KEY", "").strip()
        self.gigachat_scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
        self.gigachat_model = os.getenv("GIGACHAT_MODEL", "GigaChat")
        self.gigachat_vision_model = os.getenv("GIGACHAT_VISION_MODEL", "GigaChat-Pro")
        self.gigachat_ca_bundle = os.getenv("GIGACHAT_CA_BUNDLE", "").strip()
        self.gigachat_verify_ssl = _env_bool("GIGACHAT_VERIFY_SSL", True)
        self.gigachat_timeout = float(os.getenv("GIGACHAT_TIMEOUT", "25"))
        self.ai_min_confidence = float(os.getenv("AI_MIN_CONFIDENCE", "0.5"))

        self.telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        self.telegram_staff_chat_id = os.getenv("TELEGRAM_STAFF_CHAT_ID", "").strip()

        self.seed_demo = _env_bool("SEED_DEMO", True)
        self.show_demo_logins = _env_bool("SHOW_DEMO_LOGINS", True)
        self.demo_admin_password = os.getenv("DEMO_ADMIN_PASSWORD", "upk-admin-2026")
        self.demo_staff_password = os.getenv("DEMO_STAFF_PASSWORD", "upk-staff-2026")
        self.demo_executor_password = os.getenv("DEMO_EXECUTOR_PASSWORD", "upk-exec-2026")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_https(self) -> bool:
        return self.public_url.startswith("https://")

    @property
    def gigachat_enabled(self) -> bool:
        return bool(self.gigachat_auth_key)

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_token)

    @property
    def gigachat_verify(self) -> bool | str:
        if self.gigachat_ca_bundle:
            bundle = _env_path("GIGACHAT_CA_BUNDLE", Path(self.gigachat_ca_bundle))
            if bundle.exists():
                return str(bundle)
        return self.gigachat_verify_ssl

    def production_problems(self) -> list[str]:
        """Что мешает запуску в боевом режиме. Демо-настройки на настоящем сервере опасны, поэтому старт прерывается."""
        if not self.is_production:
            return []
        problems = []
        if not self.is_https:
            problems.append("PUBLIC_URL должен начинаться с https://")
        if self.show_demo_logins:
            problems.append("SHOW_DEMO_LOGINS должен быть false: иначе пароли видны на странице входа")
        if self.seed_demo:
            problems.append("SEED_DEMO должен быть false: демо-заявки не нужны на настоящем сервере")
        passwords = {self.demo_admin_password, self.demo_staff_password, self.demo_executor_password}
        if passwords & DEFAULT_DEMO_PASSWORDS:
            problems.append("задайте свои DEMO_ADMIN_PASSWORD, DEMO_STAFF_PASSWORD и DEMO_EXECUTOR_PASSWORD")
        if self.database_url.startswith("sqlite"):
            problems.append("DATABASE_URL должен указывать на PostgreSQL")
        if not self.gigachat_verify_ssl:
            problems.append("GIGACHAT_VERIFY_SSL должен быть true")
        return problems

    def ensure_production_ready(self) -> None:
        problems = self.production_problems()
        if problems:
            raise RuntimeError("Боевой режим не запущен: " + "; ".join(problems))


settings = Settings()
