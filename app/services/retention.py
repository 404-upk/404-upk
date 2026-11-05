"""Срок хранения личных данных: всё, что больше не нужно для работы, удаляется само."""

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..models import AiLog, Attachment, Comment, Ticket, Tracker, UserSession, utcnow

log = logging.getLogger("upk.retention")

DAY_SECONDS = 24 * 3600
REMOVED_TEXT = "Удалено по сроку хранения"


def purge(db: Session) -> None:
    """Очищает истёкшие сессии, тексты обращений к ИИ и контакты по давно закрытым заявкам. Цифры для статистики остаются."""
    now = utcnow()
    db.execute(delete(UserSession).where(UserSession.expires_at < now))

    if settings.ai_log_retention_days > 0:
        cutoff = now - timedelta(days=settings.ai_log_retention_days)
        db.execute(update(AiLog).where(AiLog.created_at < cutoff, AiLog.message != "").values(message="", answer=""))

    if settings.contact_retention_days > 0:
        cutoff = now - timedelta(days=settings.contact_retention_days)
        closed = select(Ticket.id).where(Ticket.closed_at < cutoff)
        db.execute(
            update(Ticket)
            .where(Ticket.id.in_(closed), Ticket.contact.is_not(None))
            .values(contact=None, updated_at=Ticket.updated_at)  # дата изменения заявки от очистки не меняется
        )
        db.execute(
            update(Tracker)
            .where(Tracker.ticket_id.in_(closed), Tracker.tg_chat_id.is_not(None))
            .values(tg_chat_id=None)
        )
    if settings.ticket_retention_days > 0:
        cutoff = now - timedelta(days=settings.ticket_retention_days)
        closed = select(Ticket.id).where(Ticket.closed_at < cutoff)
        for attachment in db.scalars(select(Attachment).where(Attachment.ticket_id.in_(closed))).all():
            (settings.upload_dir / attachment.storage_key).unlink(missing_ok=True)
            db.delete(attachment)
        db.execute(update(Comment).where(Comment.ticket_id.in_(closed)).values(body=REMOVED_TEXT))
        db.execute(
            update(Ticket)
            .where(Ticket.id.in_(closed), Ticket.description != REMOVED_TEXT)
            .values(description=REMOVED_TEXT, rating_comment=None, updated_at=Ticket.updated_at)
        )
    db.commit()


def _run_once() -> None:
    with SessionLocal() as db:
        purge(db)


async def retention_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(_run_once)
        except Exception:
            log.exception("Не удалось очистить устаревшие данные")
        await asyncio.sleep(DAY_SECONDS)
