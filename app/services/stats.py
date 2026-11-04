from collections import Counter, defaultdict
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AiLog, Category, Location, Ticket, utcnow
from .tickets import CLOSED_STATUSES, STATUS_LABELS

AI_KIND_LABELS = {
    "question": "Вопрос",
    "fault": "Неисправность",
    "danger": "Опасная ситуация",
    "unclear": "Нужно уточнить",
    "unknown": "Нет данных",
    "secret": "Закрытые данные",
}


def build_stats(db: Session, days: int = 14) -> dict:
    now = utcnow()
    tickets = db.scalars(select(Ticket)).all()
    categories = {c.id: c for c in db.scalars(select(Category)).all()}
    locations = {loc.id: loc for loc in db.scalars(select(Location)).all()}

    status_counts = Counter(t.status for t in tickets)
    open_count = sum(1 for t in tickets if t.status not in CLOSED_STATUSES)

    resolved = [t for t in tickets if t.status == "resolved" and t.closed_at]
    avg_hours = None
    if resolved:
        total = sum((t.closed_at - t.created_at).total_seconds() for t in resolved)
        avg_hours = round(total / len(resolved) / 3600, 1)

    by_category = []
    cat_total, cat_open = Counter(), Counter()
    for t in tickets:
        cat_total[t.category_id] += 1
        if t.status not in CLOSED_STATUSES:
            cat_open[t.category_id] += 1
    for cid, count in cat_total.most_common():
        c = categories.get(cid)
        if c:
            by_category.append({"code": c.code, "name": c.name, "icon": c.icon, "count": count, "open": cat_open[cid]})

    loc_total, loc_open = Counter(), Counter()
    for t in tickets:
        if t.location_id:
            loc_total[t.location_id] += 1
            if t.status not in CLOSED_STATUSES:
                loc_open[t.location_id] += 1
    by_location = [
        {"id": lid, "title": locations[lid].full_title, "count": count, "open": loc_open[lid]}
        for lid, count in loc_total.most_common(8)
        if lid in locations
    ]

    start = (now - timedelta(days=days - 1)).date()
    daily = {start + timedelta(days=i): {"created": 0, "closed": 0} for i in range(days)}
    for t in tickets:
        d = t.created_at.date()
        if d in daily:
            daily[d]["created"] += 1
        if t.closed_at and t.closed_at.date() in daily:
            daily[t.closed_at.date()]["closed"] += 1

    # одна и та же проблема в одном месте за 30 дней
    month_ago = now - timedelta(days=30)
    groups: dict[tuple[int, int], list[Ticket]] = defaultdict(list)
    for t in tickets:
        if t.location_id and t.created_at >= month_ago:
            groups[(t.location_id, t.category_id)].append(t)
    repeated = [
        {
            "location_id": lid,
            "place": locations[lid].full_title,
            "category": categories[cid].name,
            "count": len(items),
            "last": max(i.created_at for i in items).isoformat(timespec="seconds") + "Z",
        }
        for (lid, cid), items in groups.items()
        if len(items) >= 2 and lid in locations and cid in categories
    ]
    repeated.sort(key=lambda r: r["count"], reverse=True)

    logs = db.scalars(select(AiLog)).all()
    ai_kinds = Counter(log.kind for log in logs)
    to_ticket = sum(1 for log in logs if log.ticket_id)
    rated = [t.rating for t in tickets if t.rating]

    return {
        "total": len(tickets),
        "open": open_count,
        "resolved": status_counts.get("resolved", 0),
        "rejected": status_counts.get("rejected", 0),
        "critical_open": sum(1 for t in tickets if t.priority == "critical" and t.status not in CLOSED_STATUSES),
        "avg_resolution_hours": avg_hours,
        "duplicates_merged": sum(max(t.reports_count - 1, 0) for t in tickets),
        "rating_avg": round(sum(rated) / len(rated), 1) if rated else None,
        "rating_count": len(rated),
        "by_status": [
            {"status": s, "label": label, "count": status_counts.get(s, 0)} for s, label in STATUS_LABELS.items()
        ],
        "by_category": by_category,
        "by_location": by_location,
        "daily": [{"date": d.isoformat(), **v} for d, v in daily.items()],
        "repeated": repeated[:8],
        "ai": {
            "total": len(logs),
            "to_ticket": to_ticket,
            "answered_only": len(logs) - to_ticket,
            "by_kind": [{"kind": k, "label": AI_KIND_LABELS.get(k, k), "count": c} for k, c in ai_kinds.most_common()],
            "engine": dict(Counter(log.engine for log in logs)),
            "avg_latency_ms": round(sum(log.latency_ms for log in logs) / len(logs)) if logs else None,
        },
    }
