from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ROLES, User, UserSession
from ..schemas import LoginIn, PasswordChangeIn
from ..security import (
    SESSION_COOKIE,
    client_ip,
    create_session,
    current_user,
    drop_session,
    hash_password,
    hash_token,
    login_ip_limiter,
    login_limiter,
    password_problem,
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
        "must_change_password": user.must_change_password,
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


@router.post("/password")
def change_password(
    payload: PasswordChangeIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    login_limiter.check(f"{client_ip(request)}:password:{user.id}")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Текущий пароль указан неверно")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, "Новый пароль должен отличаться от старого")
    problem = password_problem(payload.new_password, user.login)
    if problem:
        raise HTTPException(400, problem)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    # остальные сессии этого сотрудника закрываются: старый пароль мог кто-то знать
    current = hash_token(request.cookies.get(SESSION_COOKIE, ""))
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.token_hash != current))
    db.commit()
    return user_dict(user)
