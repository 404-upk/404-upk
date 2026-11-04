"""Как заявка выглядит в ответах API: для списка, для карточки сотрудника и для страницы заявителя."""

from ..models import Category, Ticket, TicketHistory, Tracker, User
from ..security import format_code
from .tickets import (
    CLOSED_STATUSES,
    NOTE_REQUIRED,
    PRIORITY_LABELS,
    STATUS_LABELS,
    allowed_transitions,
    iso,
)


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
