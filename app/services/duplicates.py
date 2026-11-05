import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Category, Ticket, utcnow
from .tickets import CLOSED_STATUSES, STATUS_LABELS, iso

LOOKBACK_DAYS = 14
MIN_SCORE = 0.34

_STOP = set(
    "в во на не и а с со у по к из за от до что как это уже очень кабинет кабинете каб аудитории аудитория тут здесь".split()
)


def _stems(text: str) -> set[str]:
    words = re.findall(r"[а-яёa-z0-9]+", text.lower().replace("ё", "е"))
    return {w[:5] for w in words if w not in _STOP and len(w) > 2}


def similarity(a: str, b: str) -> float:
    sa, sb = _stems(a), _stems(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / min(len(sa), len(sb))


def find_similar(
    db: Session, location_id: int | None, category: Category | None, text: str, limit: int = 3
) -> list[dict]:
    """Открытые заявки в том же помещении, похожие по смыслу. Без помещения дубли не ищем."""
    if not location_id:
        return []
    since = utcnow() - timedelta(days=LOOKBACK_DAYS)
    rows = db.scalars(
        select(Ticket).where(
            Ticket.location_id == location_id,
            Ticket.status.not_in(CLOSED_STATUSES),
            Ticket.created_at >= since,
        )
    ).all()

    scored = []
    for t in rows:
        score = similarity(text, f"{t.title} {t.description}")
        if category and t.category_id == category.id:
            score += 0.15
        if score >= MIN_SCORE:
            scored.append((min(score, 1.0), t))
    scored.sort(key=lambda x: x[0], reverse=True)

    # наружу отдаём только заголовок и статус: описание может быть личным
    return [
        {
            "number": t.number,
            "public_number": t.public_number,
            "title": t.title,
            "category": t.category.name,
            "status": t.status,
            "status_label": STATUS_LABELS[t.status],
            "reports_count": t.reports_count,
            "created_at": iso(t.created_at),
            "score": round(score, 2),
        }
        for score, t in scored[:limit]
    ]
