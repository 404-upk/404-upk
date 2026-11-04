from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ROLES, User
from ..schemas import LoginIn
from ..security import (
    client_ip,
    create_session,
    current_user,
    drop_session,
    hash_password,
    login_ip_limiter,
    login_limiter,
    verify_password,
)
from ..services.telegram import bot

router = APIRouter(prefix="/api/auth", tags=["Вход"])

# чтобы время ответа не выдавало, существует ли логин
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "position": user.position,
        "login": user.login,
        "role": user.role,
        "role_label": ROLES.get(user.role, user.role),
        "telegram_linked": bool(user.tg_chat_id),
    }


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    login_ip_limiter.check(ip)
    login_limiter.check(f"{ip}:{payload.login.lower()}")
    user = db.scalar(select(User).where(User.login == payload.login.strip().lower()))
    password_ok = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not password_ok or not user.is_active:
        raise HTTPException(401, "Неверный логин или пароль")
    create_session(db, user, response)
    return user_dict(user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    drop_session(db, request, response)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    data = user_dict(user)
    data["telegram_available"] = bot.enabled
    return data


@router.post("/telegram-link")
def telegram_link(user: User = Depends(current_user)):
    url = bot.staff_link(user)
    if not url:
        raise HTTPException(400, "Telegram-бот не подключён на сервере")
    return {"url": url}
