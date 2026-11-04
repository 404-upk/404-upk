"""Состояние помещений колледжа: сколько помещений без открытых заявок и что происходит в каждом.

Наружу уходят только счётчики, состояния и заголовки заявок, как в поиске дублей.
"""

from collections import defaultdict
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Location, Ticket, utcnow
from .tickets import OPEN_STATUSES, STATUS_LABELS, iso

CHRONIC_COUNT = 3  # столько заявок за 30 дней — помещение с повторяющимися проблемами
CALM_INDEX = 90  # от этой доли помещений без заявок — «всё работает»
BUSY_INDEX = 70  # от этой — «идёт работа»

CAMPUS_LABELS = {"calm": "Всё работает", "busy": "Идёт работа", "heavy": "Повышенная нагрузка"}
ROOM_LABELS = {
    "clear": "Открытых заявок нет",
    "open": "Есть открытая заявка",
    "urgent": "Есть срочная заявка",
}


def room_state(open_count: int, critical: bool) -> str:
    if critical:
        return "urgent"
    return "open" if open_count else "clear"


def campus_state(index: int) -> str:
    if index >= CALM_INDEX:
        return "calm"
    return "busy" if index >= BUSY_INDEX else "heavy"


def location_counts(db: Session) -> tuple[dict, dict, set]:
    month_ago = utcnow() - timedelta(days=30)
    open_counts = dict(
        db.execute(
            select(Ticket.location_id, func.count(Ticket.id))
            .where(Ticket.status.in_(OPEN_STATUSES))
            .group_by(Ticket.location_id)
        ).all()
    )
    month_counts = dict(
        db.execute(
            select(Ticket.location_id, func.count(Ticket.id))
            .where(Ticket.created_at >= month_ago)
            .group_by(Ticket.location_id)
        ).all()
    )
    critical = set(
        db.scalars(
            select(Ticket.location_id).where(Ticket.status.in_(OPEN_STATUSES), Ticket.priority == "critical")
        ).all()
    )
    return open_counts, month_counts, critical


def campus_summary(db: Session) -> dict:
    """Доля помещений без открытых заявок и состояние помещений по корпусам."""
    locations = db.scalars(
        select(Location).where(Location.is_active).order_by(Location.building, Location.floor, Location.room)
    ).all()
    open_counts, month_counts, critical = location_counts(db)

    buildings: dict[str, list] = defaultdict(list)
    for loc in locations:
        opened = open_counts.get(loc.id, 0)
        buildings[loc.building].append(
            {
                "id": loc.id,
                "title": loc.title,
                "floor": loc.floor,
                "kind": loc.kind,
                "state": room_state(opened, loc.id in critical),
                "chronic": month_counts.get(loc.id, 0) >= CHRONIC_COUNT,
            }
        )

    total = len(locations)
    clear = sum(1 for rooms in buildings.values() for r in rooms if r["state"] == "clear")
    index = round(clear / total * 100) if total else 100
    state = campus_state(index)
    return {
        "rooms_total": total,
        "rooms_clear": clear,
        "index": index,
        "state": state,
        "label": CAMPUS_LABELS[state],
        "buildings": [
            {
                "building": name,
                "rooms_total": len(rooms),
                "rooms_clear": sum(1 for r in rooms if r["state"] == "clear"),
                "rooms": rooms,
            }
            for name, rooms in buildings.items()
        ],
    }


def room_status(db: Session, location: Location, limit: int = 3) -> dict:
    """Состояние одного помещения и открытые заявки, к которым можно присоединиться."""
    rows = db.scalars(
        select(Ticket)
        .where(Ticket.location_id == location.id, Ticket.status.in_(OPEN_STATUSES))
        .order_by(Ticket.created_at.desc())
    ).all()
    critical = any(t.priority == "critical" for t in rows)
    month_ago = utcnow() - timedelta(days=30)
    month = db.scalar(
        select(func.count(Ticket.id)).where(Ticket.location_id == location.id, Ticket.created_at >= month_ago)
    )
    state = room_state(len(rows), critical)
    return {
        "location_id": location.id,
        "state": state,
        "label": ROOM_LABELS[state],
        "open": len(rows),
        "chronic": (month or 0) >= CHRONIC_COUNT,
        # наружу только заголовок и статус: описание может быть личным
        "issues": [
            {
                "number": t.number,
                "public_number": t.public_number,
                "title": t.title,
                "category": t.category.name,
                "status": t.status,
                "status_label": STATUS_LABELS[t.status],
                "reports_count": t.reports_count,
                "created_at": iso(t.created_at),
            }
            for t in rows[:limit]
        ],
    }


def building_map(db: Session) -> list[dict]:
    """Помещения по корпусам и этажам для карты в панели: открытые заявки, заявки за месяц, срочные."""
    locations = db.scalars(
        select(Location).where(Location.is_active).order_by(Location.building, Location.floor, Location.room)
    ).all()
    open_counts, month_counts, critical = location_counts(db)

    buildings: dict[str, dict[int | None, list]] = defaultdict(lambda: defaultdict(list))
    for loc in locations:
        buildings[loc.building][loc.floor].append(
            {
                "id": loc.id,
                "title": loc.title,
                "room": loc.room,
                "zone_name": loc.zone_name,
                "kind": loc.kind,
                "open": open_counts.get(loc.id, 0),
                "month": month_counts.get(loc.id, 0),
                "critical": loc.id in critical,
            }
        )
    return [
        {
            "building": name,
            "floors": [
                {"floor": floor, "locations": items}
                for floor, items in sorted(floors.items(), key=lambda x: (x[0] is None, -(x[0] or 0)))
            ],
        }
        for name, floors in buildings.items()
    ]
