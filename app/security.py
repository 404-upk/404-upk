import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

import bcrypt
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import ROLE_ADMIN, ROLE_EXECUTOR, ROLE_STAFF, User, UserSession, utcnow

# префикс __Host- браузер принимает только с Secure и без Domain: cookie нельзя подменить с поддомена
SESSION_COOKIE = "__Host-upk_session" if settings.cookie_secure else "upk_session"

# без 0/O, 1/I/L и U, чтобы код было легко продиктовать и переписать
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
CODE_LENGTH = 16


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_tracking_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch.isalnum())


def format_code(code: str) -> str:
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        # адрес добавляет наш прокси, и он последний в списке; всё левее мог прислать сам клиент
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Простой лимит запросов в памяти процесса: не больше limit за window секунд."""

    def __init__(self, limit: int, window: int) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._calls = 0

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._calls += 1
            if self._calls % 1024 == 0:
                self._forget_old(now)
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(429, "Слишком много запросов. Подождите немного и попробуйте снова.")
            hits.append(now)

    def _forget_old(self, now: float) -> None:
        # без этого словарь рос бы с каждым новым адресом
        for key in [k for k, hits in self._hits.items() if not hits or now - hits[-1] > self.window]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = RateLimiter(limit=10, window=300)
login_ip_limiter = RateLimiter(limit=40, window=300)  # перебор разных логинов с одного адреса
lookup_limiter = RateLimiter(limit=settings.rate_lookup, window=300)
assistant_limiter = RateLimiter(limit=settings.rate_assistant, window=300)
ticket_limiter = RateLimiter(limit=settings.rate_tickets, window=600)
join_limiter = RateLimiter(limit=settings.rate_joins, window=600)
track_limiter = RateLimiter(limit=settings.rate_track, window=300)


def create_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    db.execute(delete(UserSession).where(UserSession.expires_at < utcnow()))
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
        )
    )
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def drop_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", secure=settings.cookie_secure, httponly=True, samesite="strict")


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if not session or session.expires_at < utcnow() or not session.user.is_active:
        return None
    return session.user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Нужно войти в систему")
    return user


def require_roles(*roles: str):
    def checker(user: User = Depends(current_user)) -> User:
        # с временным паролем доступны только вход, выход и смена пароля
        if user.must_change_password:
            raise HTTPException(403, "Сначала смените временный пароль")
        if user.role not in roles:
            raise HTTPException(403, "Недостаточно прав для этого действия")
        return user

    return checker


any_staff = require_roles(ROLE_ADMIN, ROLE_STAFF, ROLE_EXECUTOR)
upk_staff = require_roles(ROLE_ADMIN, ROLE_STAFF)
admin_only = require_roles(ROLE_ADMIN)


MIN_PASSWORD_LENGTH = 12
# самые частые пароли из утечек; длинные варианты, которые проходят по длине
COMMON_PASSWORDS = {
    "123456789012",
    "1234567890123",
    "qwertyuiop12",
    "qwerty123456",
    "password1234",
    "password12345",
    "1q2w3e4r5t6y",
    "йцукенгшщзхъ",
    "пароль123456",
    "administrator",
    "adminadmin123",
}


def password_problem(password: str, login: str = "") -> str | None:
    """Почему пароль не подходит, или None, если подходит."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов"
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or len(set(password)) < 4:
        return "Этот пароль слишком простой, его легко подобрать"
    if password.isdigit():
        return "Пароль не должен состоять только из цифр"
    if login and login.lower() in lowered:
        return "Пароль не должен содержать логин"
    return None


TEMP_ALPHABET = CODE_ALPHABET + CODE_ALPHABET.lower()


def temporary_password() -> str:
    """Временный пароль для первого входа: четыре группы по четыре символа, без похожих букв и цифр."""
    return "-".join("".join(secrets.choice(TEMP_ALPHABET) for _ in range(4)) for _ in range(4))
