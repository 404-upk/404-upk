import time
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai import assistant
from ..ai.gigachat import client as gigachat
from ..ai.text import mask_personal
from ..config import settings
from ..db import get_db
from ..models import AiLog, Category, Location, Ticket, utcnow
from ..schemas import AssistantIn, JoinIn, SimilarIn
from ..security import assistant_limiter, client_ip, format_code, join_limiter, lookup_limiter, ticket_limiter
from ..services import campus
from ..services import tickets as ts
from ..services.duplicates import find_similar
from ..services.telegram import bot
from ..services.uploads import read_image, save_attachment

router = APIRouter(prefix="/api", tags=["Заявитель"])


def location_dict(loc: Location) -> dict:
    return {
        "id": loc.id,
        "building": loc.building,
        "floor": loc.floor,
        "room": loc.room,
        "zone_name": loc.zone_name,
        "kind": loc.kind,
        "title": loc.title,
        "full_title": loc.full_title,
    }


@router.get("/meta")
def meta(db: Session = Depends(get_db)):
    categories = db.scalars(select(Category).order_by(Category.sort)).all()
    return {
        "categories": [
            {"id": c.id, "code": c.code, "name": c.name, "description": c.description, "icon": c.icon}
            for c in categories
        ],
        "statuses": [{"value": k, "label": v} for k, v in ts.STATUS_LABELS.items()],
        "priorities": [{"value": k, "label": v} for k, v in ts.PRIORITY_LABELS.items()],
        "ai": {"engine": "gigachat" if gigachat.enabled else "demo", "photo": gigachat.enabled},
        "telegram": {"enabled": bot.enabled, "username": bot.username},
        "max_upload_mb": settings.max_upload_mb,
        "demo_logins": demo_logins() if settings.show_demo_logins else None,
        "demo_data": settings.seed_demo,
    }


def demo_logins() -> list[dict]:
    # для показа жюри; в боевой установке отключается через SHOW_DEMO_LOGINS=false
    logins = [
        {"label": "Администратор", "login": "admin", "password": settings.demo_admin_password},
        {"label": "Сотрудник УПК", "login": "upk", "password": settings.demo_staff_password},
        {"label": "Электрик", "login": "electric", "password": settings.demo_executor_password},
    ]
    return [item for item in logins if item["login"] in settings.demo_logins_shown]


@router.get("/locations")
def locations(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Location).where(Location.is_active).order_by(Location.building, Location.floor, Location.room)
    ).all()
    return [location_dict(loc) for loc in rows]


@router.get("/locations/qr/{qr_key}")
def location_by_qr(qr_key: str, db: Session = Depends(get_db)):
    loc = db.scalar(select(Location).where(Location.qr_key == qr_key.lower()[:20]))
    if not loc or not loc.is_active:
        raise HTTPException(404, "Этот QR-код не привязан ни к одному помещению. Выберите место вручную.")
    return location_dict(loc)


@router.get("/locations/{location_id}/status")
def location_status(location_id: int, db: Session = Depends(get_db)):
    loc = db.get(Location, location_id)
    if not loc or not loc.is_active:
        raise HTTPException(404, "Помещение не найдено")
    return campus.room_status(db, loc)


@router.get("/campus")
def campus_status(db: Session = Depends(get_db)):
    return campus.campus_summary(db)


@router.post("/assistant")
async def ask_assistant(payload: AssistantIn, request: Request, db: Session = Depends(get_db)):
    assistant_limiter.check(client_ip(request))
    location = db.get(Location, payload.location_id) if payload.location_id else None

    started = time.perf_counter()
    reply = await assistant.analyze(db, payload.message, location, payload.context)
    latency = round((time.perf_counter() - started) * 1000)

    entry = AiLog(
        message=mask_personal(" / ".join([*payload.context[-3:], payload.message]))[:2000],
        location_id=location.id if location else None,
        kind=reply.kind,
        category_code=reply.category,
        confidence=reply.confidence,
        engine=reply.engine,
        answer=reply.answer[:2000],
        latency_ms=latency,
    )
    db.add(entry)
    db.commit()

    data = reply.to_dict()
    data["analysis_id"] = entry.id
    data["latency_ms"] = latency
    data["suggested_location"] = None
    if not location and reply.room_hint:
        hint = db.scalar(select(Location).where(Location.room == reply.room_hint, Location.is_active))
        if hint:
            data["suggested_location"] = location_dict(hint)
    return data


@router.post("/assistant/photo")
async def ask_photo(request: Request, photo: UploadFile = File(...), db: Session = Depends(get_db)):
    assistant_limiter.check(client_ip(request))
    data = await read_image(photo)
    if not data:
        raise HTTPException(400, "Фото не получено")
    return await assistant.analyze_photo(db, data)


@router.post("/tickets/similar")
def similar(payload: SimilarIn, request: Request, db: Session = Depends(get_db)):
    lookup_limiter.check(client_ip(request))
    category = db.scalar(select(Category).where(Category.code == payload.category)) if payload.category else None
    return find_similar(db, payload.location_id, category, payload.text)


@router.post("/tickets/{number}/join")
def join(number: int, payload: JoinIn, request: Request, db: Session = Depends(get_db)):
    join_limiter.check(client_ip(request))
    ticket = db.scalar(select(Ticket).where(Ticket.number == number))
    # присоединиться можно только к открытой заявке в том же помещении, где стоит человек
    if not ticket or ticket.location_id != payload.location_id or ticket.status in ts.CLOSED_STATUSES:
        raise HTTPException(404, "Заявка не найдена или уже закрыта")
    code = ts.join_ticket(db, ticket)
    return _created_response(ticket, code)


def _created_response(ticket: Ticket, code: str | None) -> dict:
    return {
        "id": ticket.id,
        "public_number": ticket.public_number,
        "status_label": ts.STATUS_LABELS[ticket.status],
        "created_at": ts.iso(ticket.created_at),
        "code": format_code(code) if code else None,
        "tracking_url": f"/t/{code}" if code else None,
        "telegram_url": bot.tracker_link(code) if code else None,
    }


@router.post("/tickets", status_code=201)
async def create_ticket(
    request: Request,
    background: BackgroundTasks,
    description: str = Form(..., max_length=2000),
    title: str = Form("", max_length=120),
    category: str = Form("other", max_length=30),
    location_id: int | None = Form(None),
    location_note: str = Form("", max_length=160),
    contact: str = Form("", max_length=120),
    priority: str = Form("", max_length=10),
    client_request_id: str = Form("", max_length=64),
    analysis_id: int | None = Form(None),
    source: str = Form("manual", max_length=10),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    description = description.strip()
    if len(description) < 5:
        raise HTTPException(400, "Опишите проблему хотя бы парой слов")

    # повторная отправка той же формы (двойной клик, обрыв сети) не создаёт дубль
    request_id = client_request_id.strip() or None
    if request_id:
        found = ts.find_by_request_id(db, request_id)
        if found:
            return _created_response(*found)

    ticket_limiter.check(client_ip(request))

    cat = db.scalar(select(Category).where(Category.code == category)) or db.scalar(
        select(Category).where(Category.code == "other")
    )
    location = db.get(Location, location_id) if location_id else None
    if location_id and (not location or not location.is_active):
        raise HTTPException(400, "Выбранное помещение не найдено, выберите место заново")
    note = location_note.strip() or None
    if not location and not note:
        raise HTTPException(400, "Укажите, где случилась проблема: выберите помещение или напишите корпус и кабинет")

    photo_data = await read_image(photo)

    ai_log = db.get(AiLog, analysis_id) if analysis_id else None
    if ai_log and (ai_log.ticket_id or ai_log.created_at < utcnow() - timedelta(hours=2)):
        ai_log = None

    clean_title = title.strip() or description[:60]
    # запись в базу и разбор фото не должны держать цикл событий
    ticket, code, _ = await run_in_threadpool(
        ts.create_ticket,
        db,
        title=clean_title[:120],
        description=description,
        category=cat,
        location=location,
        location_note=note,
        contact=contact.strip() or None,
        source="qr" if source == "qr" and location else "manual",
        client_request_id=request_id,
        priority=priority,
        ai={"kind": ai_log.kind, "engine": ai_log.engine, "confidence": ai_log.confidence} if ai_log else None,
    )

    if photo_data:
        try:
            await run_in_threadpool(save_attachment, db, ticket, photo_data, photo.filename if photo else None)
            db.commit()
        except (HTTPException, OSError):
            # заявка уже сохранена, фото просто не прикрепится; сообщим об этом
            db.rollback()
            response = _created_response(ticket, code)
            response["warning"] = "Заявка сохранена, но фото прикрепить не удалось"
            return response

    if ai_log:
        ai_log.ticket_id = ticket.id
        db.commit()

    background.add_task(bot.ticket_created, ticket.id)
    return _created_response(ticket, code)
