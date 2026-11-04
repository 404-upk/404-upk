from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Attachment, Tracker
from ..schemas import RateIn, ReplyIn
from ..security import CODE_LENGTH, client_ip, hash_token, normalize_code, track_limiter
from ..services import tickets as ts
from ..services import views
from ..services.qr import qr_svg
from ..services.telegram import bot
from ..services.uploads import attachment_path

router = APIRouter(prefix="/api/track", tags=["Отслеживание"])

NOT_FOUND = "Заявка не найдена. Проверьте код отслеживания: 16 символов, буквы и цифры."


def get_tracker(code: str, request: Request, db: Session) -> tuple[Tracker, str]:
    track_limiter.check(client_ip(request))
    normalized = normalize_code(code)
    if len(normalized) != CODE_LENGTH:
        raise HTTPException(404, NOT_FOUND)
    tracker = db.scalar(select(Tracker).where(Tracker.token_hash == hash_token(normalized)))
    if not tracker:
        raise HTTPException(404, NOT_FOUND)
    return tracker, normalized


@router.get("/{code}")
def track(code: str, request: Request, db: Session = Depends(get_db)):
    tracker, normalized = get_tracker(code, request, db)
    data = views.ticket_public(tracker.ticket, tracker, normalized)
    data["telegram_url"] = bot.tracker_link(normalized)
    return data


@router.post("/{code}/reply")
def reply(code: str, payload: ReplyIn, request: Request, db: Session = Depends(get_db)):
    tracker, normalized = get_tracker(code, request, db)
    if not tracker.is_reporter:
        raise HTTPException(403, "Отвечать может только автор заявки")
    ts.reporter_reply(db, tracker.ticket, payload.body)
    db.commit()
    return views.ticket_public(tracker.ticket, tracker, normalized)


@router.post("/{code}/rate")
def rate(code: str, payload: RateIn, request: Request, db: Session = Depends(get_db)):
    tracker, normalized = get_tracker(code, request, db)
    if not tracker.is_reporter:
        raise HTTPException(403, "Оценить может только автор заявки")
    ts.rate_ticket(db, tracker.ticket, payload.rating, payload.comment)
    db.commit()
    return views.ticket_public(tracker.ticket, tracker, normalized)


@router.get("/{code}/attachments/{attachment_id}")
def attachment(code: str, attachment_id: int, request: Request, db: Session = Depends(get_db)):
    tracker, _ = get_tracker(code, request, db)
    item = db.get(Attachment, attachment_id)
    if not tracker.is_reporter or not item or item.ticket_id != tracker.ticket_id:
        raise HTTPException(404, "Файл не найден")
    return FileResponse(
        attachment_path(item), media_type=item.file_type, headers={"Cache-Control": "private, max-age=3600"}
    )


@router.get("/{code}/qr.svg")
def tracking_qr(code: str, request: Request, db: Session = Depends(get_db)):
    _, normalized = get_tracker(code, request, db)
    return Response(qr_svg(f"{settings.public_url}/t/{normalized}"), media_type="image/svg+xml")
