from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..ai.gigachat import client as gigachat
from ..ai.selftest import run_selftest
from ..db import get_db
from ..models import ROLES, Category, KnowledgeArticle, Location, Ticket, User, UserSession, utcnow
from ..schemas import ArticleIn, CategoryUpdateIn, LocationIn, UserIn, UserUpdateIn
from ..security import admin_only, hash_password, upk_staff
from ..services import tickets as ts
from ..services.qr import location_url, new_qr_key, qr_png, qr_svg

router = APIRouter(prefix="/api/manage", tags=["Администрирование"])


# ---------- сотрудники ----------


def _user(u: User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "position": u.position,
        "login": u.login,
        "role": u.role,
        "role_label": ROLES.get(u.role, u.role),
        "is_active": u.is_active,
        "telegram_linked": bool(u.tg_chat_id),
        "created_at": ts.iso(u.created_at),
    }


@router.get("/users")
def users(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    return [_user(u) for u in db.scalars(select(User).order_by(User.role, User.name)).all()]


@router.post("/users", status_code=201)
def create_user(payload: UserIn, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    login = payload.login.lower()
    if db.scalar(select(User).where(User.login == login)):
        raise HTTPException(400, "Такой логин уже занят")
    user = User(
        name=payload.name.strip(),
        position=(payload.position or "").strip() or None,
        login=login,
        role=payload.role,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    return _user(user)


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: UserUpdateIn, me: User = Depends(admin_only), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Сотрудник не найден")
    if user.id == me.id and (payload.is_active is False or (payload.role and payload.role != me.role)):
        raise HTTPException(400, "Нельзя отключить себя или снять с себя права администратора")
    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.position is not None:
        user.position = payload.position.strip() or None
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.password or payload.is_active is False:
        db.execute(UserSession.__table__.delete().where(UserSession.user_id == user.id))
    db.commit()
    return _user(user)


# ---------- помещения и QR ----------


def _location(loc: Location, counts: dict[int, int] | None = None) -> dict:
    return {
        "id": loc.id,
        "building": loc.building,
        "floor": loc.floor,
        "room": loc.room,
        "zone_name": loc.zone_name,
        "kind": loc.kind,
        "title": loc.title,
        "full_title": loc.full_title,
        "qr_key": loc.qr_key,
        "url": location_url(loc),
        "is_active": loc.is_active,
        "tickets": (counts or {}).get(loc.id, 0),
    }


@router.get("/locations")
def locations(_: User = Depends(upk_staff), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Ticket.location_id, func.count(Ticket.id)).group_by(Ticket.location_id)).all())
    rows = db.scalars(
        select(Location).order_by(Location.building, Location.floor, Location.room, Location.zone_name)
    ).all()
    return [_location(loc, counts) for loc in rows]


def _check_location(payload: LocationIn) -> None:
    if not (payload.room or "").strip() and not (payload.zone_name or "").strip():
        raise HTTPException(400, "Укажите номер кабинета или название зоны")


@router.post("/locations", status_code=201)
def create_location(payload: LocationIn, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    _check_location(payload)
    loc = Location(
        building=payload.building.strip(),
        floor=payload.floor,
        room=(payload.room or "").strip() or None,
        zone_name=(payload.zone_name or "").strip() or None,
        kind=payload.kind,
        is_active=payload.is_active,
        qr_key=new_qr_key(),
    )
    db.add(loc)
    db.commit()
    return _location(loc)


@router.patch("/locations/{location_id}")
def update_location(location_id: int, payload: LocationIn, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(404, "Помещение не найдено")
    _check_location(payload)
    loc.building = payload.building.strip()
    loc.floor = payload.floor
    loc.room = (payload.room or "").strip() or None
    loc.zone_name = (payload.zone_name or "").strip() or None
    loc.kind = payload.kind
    loc.is_active = payload.is_active
    db.commit()
    return _location(loc)


@router.post("/locations/{location_id}/regenerate")
def regenerate_qr(location_id: int, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    """Новый QR-ключ: старая наклейка перестанет работать."""
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(404, "Помещение не найдено")
    loc.qr_key = new_qr_key()
    db.commit()
    return _location(loc)


@router.get("/locations/{location_id}/qr.{fmt}")
def location_qr(location_id: int, fmt: str, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    loc = db.get(Location, location_id)
    if not loc:
        raise HTTPException(404, "Помещение не найдено")
    if fmt == "svg":
        return Response(qr_svg(location_url(loc)), media_type="image/svg+xml")
    if fmt == "png":
        name = f"qr-{loc.room or loc.qr_key}.png"
        return Response(
            qr_png(location_url(loc)),
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )
    raise HTTPException(404, "Формат не поддерживается")


# ---------- категории ----------


@router.get("/categories")
def categories(_: User = Depends(upk_staff), db: Session = Depends(get_db)):
    rows = db.scalars(select(Category).options(selectinload(Category.default_assignee)).order_by(Category.sort)).all()
    return [
        {
            "id": c.id,
            "code": c.code,
            "name": c.name,
            "description": c.description,
            "icon": c.icon,
            "default_priority": c.default_priority,
            "default_assignee": {"id": c.default_assignee.id, "name": c.default_assignee.name}
            if c.default_assignee
            else None,
        }
        for c in rows
    ]


@router.patch("/categories/{category_id}")
def update_category(
    category_id: int, payload: CategoryUpdateIn, _: User = Depends(admin_only), db: Session = Depends(get_db)
):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(404, "Категория не найдена")
    if payload.name:
        c.name = payload.name.strip()
    if payload.description is not None:
        c.description = payload.description.strip() or None
    if payload.default_priority:
        c.default_priority = payload.default_priority
    if payload.clear_assignee:
        c.default_assignee_id = None
    elif payload.default_assignee_id:
        if not db.get(User, payload.default_assignee_id):
            raise HTTPException(400, "Сотрудник не найден")
        c.default_assignee_id = payload.default_assignee_id
    db.commit()
    return {"ok": True}


# ---------- база знаний ----------


def _article(a: KnowledgeArticle) -> dict:
    return {
        "id": a.id,
        "question": a.question,
        "answer": a.answer,
        "category_id": a.category_id,
        "category": a.category.name if a.category else None,
        "keywords": a.keywords,
        "source": a.source,
        "is_active": a.is_active,
        "updated_at": ts.iso(a.updated_at),
    }


@router.get("/kb")
def kb(_: User = Depends(upk_staff), db: Session = Depends(get_db)):
    return [_article(a) for a in db.scalars(select(KnowledgeArticle).order_by(KnowledgeArticle.id)).all()]


def _fill_article(a: KnowledgeArticle, payload: ArticleIn, db: Session) -> None:
    if payload.category_id and not db.get(Category, payload.category_id):
        raise HTTPException(400, "Категория не найдена")
    a.question = payload.question.strip()
    a.answer = payload.answer.strip()
    a.category_id = payload.category_id
    a.keywords = payload.keywords.strip()
    a.source = payload.source.strip() or "База знаний УПК"
    a.is_active = payload.is_active
    a.updated_at = utcnow()


@router.post("/kb", status_code=201)
def create_article(payload: ArticleIn, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    article = KnowledgeArticle()
    _fill_article(article, payload, db)
    db.add(article)
    db.commit()
    return _article(article)


@router.put("/kb/{article_id}")
def update_article(article_id: int, payload: ArticleIn, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    article = db.get(KnowledgeArticle, article_id)
    if not article:
        raise HTTPException(404, "Статья не найдена")
    _fill_article(article, payload, db)
    db.commit()
    return _article(article)


@router.delete("/kb/{article_id}")
def delete_article(article_id: int, _: User = Depends(upk_staff), db: Session = Depends(get_db)):
    article = db.get(KnowledgeArticle, article_id)
    if not article:
        raise HTTPException(404, "Статья не найдена")
    db.delete(article)
    db.commit()
    return {"ok": True}


# ---------- проверка ИИ ----------


@router.post("/ai/selftest")
async def ai_selftest(
    engine: str = Query("auto", pattern="^(auto|rules)$"),
    _: User = Depends(upk_staff),
    db: Session = Depends(get_db),
):
    result = await run_selftest(db, use_llm=engine == "auto")
    result["engine"] = "GigaChat" if engine == "auto" and gigachat.enabled else "Правила (демо-режим)"
    return result
