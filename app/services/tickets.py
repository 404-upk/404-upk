import re
import time
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    ROLE_EXECUTOR,
    Category,
    Comment,
    Location,
    Ticket,
    TicketHistory,
    Tracker,
    User,
    utcnow,
)
from ..security import format_code, hash_token, new_tracking_code

STATUS_LABELS = {
    "new": "Новая",
    "review": "На рассмотрении",
    "assigned": "Назначен исполнитель",
    "in_progress": "В работе",
    "need_info": "Нужны уточнения",
    "resolved": "Решена",
    "rejected": "Отклонена",
}
CLOSED_STATUSES = {"resolved", "rejected"}
OPEN_STATUSES = set(STATUS_LABELS) - CLOSED_STATUSES

# для этих статусов комментарий обязателен и виден заявителю
NOTE_REQUIRED = {"resolved", "rejected", "need_info"}

TRANSITIONS = {
    "new": {"review", "assigned", "need_info", "rejected"},
    "review": {"assigned", "in_progress", "need_info", "resolved", "rejected"},
    "assigned": {"in_progress", "review", "need_info", "rejected"},
    "in_progress": {"resolved", "need_info", "assigned"},
    "need_info": {"review", "assigned", "in_progress", "rejected"},
    "resolved": {"review"},
    "rejected": {"review"},
}
EXECUTOR_TRANSITIONS = {
    "assigned": {"in_progress"},
    "need_info": {"in_progress"},
}

PRIORITY_LABELS = {
    "low": "Низкий",
    "normal": "Обычный",
    "high": "Высокий",
    "critical": "Критический",
}

# код отслеживания хранится только хешем, поэтому при повторной отправке той же формы
# отдаём его из короткого кеша, чтобы заявитель не остался без кода
_recent_codes: dict[str, tuple[str, float]] = {}
_RECENT_TTL = 3600


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


def parse_number(query: str) -> int | None:
    digits = re.sub(r"\D", "", query)
    if digits and len(digits) <= 7:
        return int(digits)
    return None


def allowed_transitions(ticket: Ticket, user: User) -> list[str]:
    if user.role == ROLE_EXECUTOR:
        if ticket.assignee_id != user.id:
            return []
        targets = EXECUTOR_TRANSITIONS.get(ticket.status, set())
    else:
        targets = TRANSITIONS.get(ticket.status, set())
    return [s for s in STATUS_LABELS if s in targets]


def _log(
    db: Session,
    ticket: Ticket,
    action: str,
    actor: User | None = None,
    old: str | None = None,
    new: str | None = None,
    note: str | None = None,
    public: bool = True,
    actor_label: str | None = None,
) -> None:
    db.add(
        TicketHistory(
            ticket=ticket,
            actor_id=actor.id if actor else None,
            actor_label=actor_label or (actor.name if actor else "Система"),
            action=action,
            old_value=old,
            new_value=new,
            note=note,
            is_public=public,
        )
    )


def _remember_code(request_id: str | None, code: str) -> None:
    if not request_id:
        return
    now = time.monotonic()
    for key, (_, ts) in list(_recent_codes.items()):
        if now - ts > _RECENT_TTL:
            _recent_codes.pop(key, None)
    _recent_codes[request_id] = (code, now)


def find_by_request_id(db: Session, request_id: str) -> tuple[Ticket, str | None] | None:
    existing = db.scalar(select(Ticket).where(Ticket.client_request_id == request_id))
    if not existing:
        return None
    cached = _recent_codes.get(request_id)
    return existing, cached[0] if cached else None


def create_ticket(
    db: Session,
    *,
    title: str,
    description: str,
    category: Category,
    location: Location | None,
    location_note: str | None,
    contact: str | None,
    source: str,
    client_request_id: str | None,
    priority: str,
    ai: dict | None = None,
) -> tuple[Ticket, str | None, bool]:
    """Возвращает (заявка, код отслеживания, создана_сейчас)."""
    if client_request_id:
        found = find_by_request_id(db, client_request_id)
        if found:
            return found[0], found[1], False

    for _ in range(3):
        code = new_tracking_code()
        ticket = Ticket(
            number=(db.scalar(select(func.max(Ticket.number))) or 0) + 1,
            title=title,
            description=description,
            category=category,
            location=location,
            location_note=None if location else location_note,
            contact=contact,
            source=source,
            client_request_id=client_request_id,
            priority=priority if priority in PRIORITY_LABELS else category.default_priority,
            status="new",
            ai_kind=(ai or {}).get("kind"),
            ai_engine=(ai or {}).get("engine"),
            ai_confidence=(ai or {}).get("confidence"),
        )
        db.add(ticket)
        db.add(Tracker(ticket=ticket, token_hash=hash_token(code), is_reporter=True))
        _log(db, ticket, "created", new="new", actor_label="Заявитель")
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if client_request_id:
                found = find_by_request_id(db, client_request_id)
                if found:
                    return found[0], found[1], False
            continue
        _remember_code(client_request_id, code)
        return ticket, code, True
    raise HTTPException(503, "Не удалось сохранить заявку, попробуйте ещё раз")


def join_ticket(db: Session, ticket: Ticket) -> str:
    code = new_tracking_code()
    db.add(Tracker(ticket=ticket, token_hash=hash_token(code), is_reporter=False))
    ticket.reports_count += 1
    _log(db, ticket, "joined", new=str(ticket.reports_count), actor_label="Заявитель")
    db.commit()
    return code


def change_status(db: Session, ticket: Ticket, new_status: str, actor: User, note: str | None) -> str:
    if new_status not in STATUS_LABELS:
        raise HTTPException(400, "Неизвестный статус")
    if new_status == ticket.status:
        raise HTTPException(400, "Заявка уже в этом статусе")
    if new_status not in allowed_transitions(ticket, actor):
        raise HTTPException(
            400,
            f"Нельзя перевести заявку из «{STATUS_LABELS[ticket.status]}» в «{STATUS_LABELS[new_status]}»",
        )
    note = (note or "").strip() or None
    if new_status in NOTE_REQUIRED and not note:
        hints = {
            "resolved": "Опишите, что было сделано",
            "rejected": "Укажите причину отклонения",
            "need_info": "Напишите, что нужно уточнить у заявителя",
        }
        raise HTTPException(400, hints[new_status])
    if new_status == "assigned" and not ticket.assignee_id:
        raise HTTPException(400, "Сначала выберите исполнителя")

    old = ticket.status
    ticket.status = new_status
    ticket.closed_at = utcnow() if new_status in CLOSED_STATUSES else None
    if new_status in NOTE_REQUIRED:
        _log(db, ticket, "status", actor, old, new_status, note)
    else:
        _log(db, ticket, "status", actor, old, new_status)
        if note:
            db.add(Comment(ticket=ticket, author_id=actor.id, body=note, visibility="internal"))
    return old


def set_assignee(db: Session, ticket: Ticket, assignee: User | None, actor: User) -> None:
    if (assignee.id if assignee else None) == ticket.assignee_id:
        return
    old_name = ticket.assignee.name if ticket.assignee else None
    ticket.assignee = assignee
    ticket.assignee_id = assignee.id if assignee else None
    _log(db, ticket, "assignee", actor, old_name, assignee.name if assignee else None, public=False)
    if assignee and ticket.status in ("new", "review", "need_info"):
        old = ticket.status
        ticket.status = "assigned"
        _log(db, ticket, "status", actor, old, "assigned")
    elif not assignee and ticket.status == "assigned":
        ticket.status = "review"
        _log(db, ticket, "status", actor, "assigned", "review")


def set_priority(db: Session, ticket: Ticket, priority: str, actor: User) -> None:
    if priority not in PRIORITY_LABELS:
        raise HTTPException(400, "Неизвестный приоритет")
    if priority == ticket.priority:
        return
    _log(db, ticket, "priority", actor, ticket.priority, priority, public=False)
    ticket.priority = priority


def set_category(db: Session, ticket: Ticket, category: Category, actor: User) -> None:
    if category.id == ticket.category_id:
        return
    _log(db, ticket, "category", actor, ticket.category.name, category.name)
    ticket.category = category


def add_comment(db: Session, ticket: Ticket, body: str, actor: User, visibility: str) -> Comment:
    body = body.strip()
    if not body:
        raise HTTPException(400, "Комментарий пустой")
    comment = Comment(ticket=ticket, author_id=actor.id, body=body, visibility=visibility)
    db.add(comment)
    _log(db, ticket, "comment", actor, public=visibility == "public")
    return comment


def reporter_reply(db: Session, ticket: Ticket, body: str) -> None:
    body = body.strip()
    if not body:
        raise HTTPException(400, "Сообщение пустое")
    if ticket.status in CLOSED_STATUSES:
        raise HTTPException(400, "Заявка уже закрыта")
    db.add(Comment(ticket=ticket, from_reporter=True, body=body, visibility="public"))
    _log(db, ticket, "reply", actor_label="Заявитель")
    if ticket.status == "need_info":
        ticket.status = "review"
        _log(db, ticket, "status", None, "need_info", "review", actor_label="Заявитель")


def rate_ticket(db: Session, ticket: Ticket, rating: int, comment: str | None) -> None:
    if ticket.status != "resolved":
        raise HTTPException(400, "Оценить можно только решённую заявку")
    if not 1 <= rating <= 5:
        raise HTTPException(400, "Оценка от 1 до 5")
    ticket.rating = rating
    ticket.rating_comment = (comment or "").strip() or None
    _log(db, ticket, "rated", new=str(rating), actor_label="Заявитель")


# ---------- представления ----------


def _category(c: Category) -> dict:
    return {"id": c.id, "code": c.code, "name": c.name, "icon": c.icon}


def history_text(h: TicketHistory, public: bool = False) -> str:
    if h.action == "created":
        return "Заявка зарегистрирована"
    if h.action == "status":
        return f"Статус: {STATUS_LABELS.get(h.old_value, h.old_value)} → {STATUS_LABELS.get(h.new_value, h.new_value)}"
    if h.action == "assignee":
        if public:
            return "Назначен исполнитель"
        return f"Исполнитель: {h.new_value}" if h.new_value else "Исполнитель снят"
    if h.action == "priority":
        return f"Приоритет: {PRIORITY_LABELS.get(h.old_value, h.old_value)} → {PRIORITY_LABELS.get(h.new_value, h.new_value)}"
    if h.action == "category":
        return f"Категория: {h.old_value} → {h.new_value}"
    if h.action == "comment":
        return "Добавлен комментарий"
    if h.action == "reply":
        return "Заявитель ответил на вопрос"
    if h.action == "joined":
        return "Ещё один человек сообщил об этой проблеме"
    if h.action == "rated":
        return f"Заявитель оценил работу: {h.new_value} из 5"
    if h.action == "photo":
        return "Добавлено фото"
    return h.action


def ticket_brief(t: Ticket) -> dict:
    return {
        "id": t.id,
        "number": t.number,
        "public_number": t.public_number,
        "title": t.title,
        "category": _category(t.category),
        "place": t.place,
        "location_id": t.location_id,
        "status": t.status,
        "status_label": STATUS_LABELS[t.status],
        "priority": t.priority,
        "priority_label": PRIORITY_LABELS.get(t.priority, t.priority),
        "assignee": {"id": t.assignee.id, "name": t.assignee.name} if t.assignee else None,
        "reports_count": t.reports_count,
        "has_photo": bool(t.attachments),
        "ai_kind": t.ai_kind,
        "created_at": iso(t.created_at),
        "updated_at": iso(t.updated_at),
        "closed_at": iso(t.closed_at),
    }


def ticket_full(t: Ticket, user: User) -> dict:
    data = ticket_brief(t)
    suggested = t.category.default_assignee
    data.update(
        {
            "description": t.description,
            "contact": t.contact,
            "source": t.source,
            "location_note": t.location_note,
            "ai": {"kind": t.ai_kind, "engine": t.ai_engine, "confidence": t.ai_confidence} if t.ai_kind else None,
            "rating": t.rating,
            "rating_comment": t.rating_comment,
            "suggested_assignee": (
                {"id": suggested.id, "name": suggested.name}
                if suggested and suggested.is_active and suggested.id != t.assignee_id
                else None
            ),
            "transitions": [{"value": s, "label": STATUS_LABELS[s]} for s in allowed_transitions(t, user)],
            "attachments": [
                {"id": a.id, "url": f"/api/staff/attachments/{a.id}", "type": a.file_type, "size": a.size}
                for a in t.attachments
            ],
            "comments": [
                {
                    "id": c.id,
                    "body": c.body,
                    "visibility": c.visibility,
                    "author": "Заявитель" if c.from_reporter else (c.author.name if c.author else "Сотрудник"),
                    "from_reporter": c.from_reporter,
                    "created_at": iso(c.created_at),
                }
                for c in t.comments
            ],
            "history": [
                {
                    "id": h.id,
                    "action": h.action,
                    "text": history_text(h),
                    "note": h.note,
                    "actor": h.actor_label or (h.actor.name if h.actor else "Система"),
                    "is_public": h.is_public,
                    "created_at": iso(h.created_at),
                }
                for h in t.history
            ],
        }
    )
    return data


def ticket_public(t: Ticket, tracker: Tracker, code: str) -> dict:
    need_info_question = None
    if t.status == "need_info":
        for h in reversed(t.history):
            if h.action == "status" and h.new_value == "need_info":
                need_info_question = h.note
                break
    resolution = None
    if t.status in CLOSED_STATUSES:
        for h in reversed(t.history):
            if h.action == "status" and h.new_value == t.status:
                resolution = h.note
                break

    full_access = tracker.is_reporter
    return {
        "public_number": t.public_number,
        "code": format_code(code),
        "title": t.title,
        "description": t.description if full_access else None,
        "category": t.category.name,
        "place": t.place,
        "status": t.status,
        "status_label": STATUS_LABELS[t.status],
        "is_reporter": full_access,
        "reports_count": t.reports_count,
        "created_at": iso(t.created_at),
        "updated_at": iso(t.updated_at),
        "closed_at": iso(t.closed_at),
        "need_info_question": need_info_question,
        "resolution": resolution,
        "can_reply": full_access and t.status not in CLOSED_STATUSES,
        "can_rate": full_access and t.status == "resolved",
        "rating": t.rating,
        "telegram_linked": bool(tracker.tg_chat_id),
        "attachments": (
            [{"id": a.id, "url": f"/api/track/{code}/attachments/{a.id}"} for a in t.attachments] if full_access else []
        ),
        "comments": [
            {
                "body": c.body,
                "author": "Вы" if c.from_reporter else "Сотрудник УПК",
                "from_reporter": c.from_reporter,
                "created_at": iso(c.created_at),
            }
            for c in t.comments
            if c.visibility == "public" and (full_access or not c.from_reporter)
        ],
        "history": [
            {
                "action": h.action,
                "text": history_text(h, public=True),
                "note": h.note if h.action == "status" and h.new_value in NOTE_REQUIRED else None,
                "created_at": iso(h.created_at),
            }
            for h in t.history
            if h.is_public and h.action != "comment"
        ],
    }
