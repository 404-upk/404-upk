import re
import time
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select, update
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
from ..security import hash_token, new_tracking_code

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

    for attempt in range(8):
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
            # номер заняла параллельная заявка: пробуем следующий
            time.sleep(0.02 * (attempt + 1))
            continue
        _remember_code(client_request_id, code)
        return ticket, code, True
    raise HTTPException(503, "Не удалось сохранить заявку, попробуйте ещё раз")


def join_ticket(db: Session, ticket: Ticket) -> str:
    code = new_tracking_code()
    db.add(Tracker(ticket=ticket, token_hash=hash_token(code), is_reporter=False))
    # считает сама база: параллельные присоединения не должны терять обновления
    db.execute(update(Ticket).where(Ticket.id == ticket.id).values(reports_count=Ticket.reports_count + 1))
    db.flush()
    db.refresh(ticket, ["reports_count"])
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
    if old == "resolved":
        # заявку открыли снова: прежняя оценка относится к прошлому решению
        ticket.rating = None
        ticket.rating_comment = None
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
    if ticket.rating is not None:
        raise HTTPException(400, "Оценка уже поставлена")
    ticket.rating = rating
    ticket.rating_comment = (comment or "").strip() or None
    _log(db, ticket, "rated", new=str(rating), actor_label="Заявитель")
