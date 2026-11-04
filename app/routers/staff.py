import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db, lower
from ..models import ROLE_ADMIN, ROLE_EXECUTOR, ROLE_STAFF, Attachment, Category, Location, Ticket, User, utcnow
from ..schemas import CommentIn, TicketUpdateIn
from ..security import any_staff, upk_staff
from ..services import tickets as ts
from ..services.stats import build_stats
from ..services.telegram import bot
from ..services.uploads import attachment_path

router = APIRouter(prefix="/api/staff", tags=["Панель УПК"])

PRIORITY_RANK = {"critical": 0, "high": 1, "normal": 2, "low": 3}


class Filters:
    def __init__(
        self,
        q: str = "",
        status: str = "",
        category: int | None = None,
        location: int | None = None,
        assignee: str = "",
        priority: str = "",
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> None:
        self.q = q.strip()
        self.status = status
        self.category = category
        self.location = location
        self.assignee = assignee
        self.priority = priority
        self.date_from = date_from
        self.date_to = date_to

    def apply(self, stmt, user: User, with_status: bool = True):
        if user.role == ROLE_EXECUTOR:
            stmt = stmt.where(Ticket.assignee_id == user.id)
        if self.q:
            needle = f"%{self.q.lower()}%"
            conditions = [
                lower(Ticket.title).like(needle),
                lower(Ticket.description).like(needle),
                Location.room == self.q,
            ]
            number = ts.parse_number(self.q)
            if number is not None:
                conditions.append(Ticket.number == number)
            stmt = stmt.where(or_(*conditions))
        if with_status and self.status:
            wanted = set()
            for s in self.status.split(","):
                wanted |= ts.OPEN_STATUSES if s == "open" else {s}
            stmt = stmt.where(Ticket.status.in_(wanted))
        if self.category:
            stmt = stmt.where(Ticket.category_id == self.category)
        if self.location:
            stmt = stmt.where(Ticket.location_id == self.location)
        if self.priority:
            stmt = stmt.where(Ticket.priority.in_(self.priority.split(",")))
        if self.assignee == "none":
            stmt = stmt.where(Ticket.assignee_id.is_(None))
        elif self.assignee.isdigit():
            stmt = stmt.where(Ticket.assignee_id == int(self.assignee))
        if self.date_from:
            stmt = stmt.where(Ticket.created_at >= datetime.combine(self.date_from, datetime.min.time()))
        if self.date_to:
            stmt = stmt.where(
                Ticket.created_at < datetime.combine(self.date_to + timedelta(days=1), datetime.min.time())
            )
        return stmt


def _base_query():
    return select(Ticket).outerjoin(Location, Ticket.location_id == Location.id)


def _with_relations(stmt):
    # связи загружаются одним запросом на всю страницу, а не отдельным на каждую заявку
    return stmt.options(
        selectinload(Ticket.category),
        selectinload(Ticket.location),
        selectinload(Ticket.assignee),
        selectinload(Ticket.attachments),
    )


def _ticket_for(db: Session, ticket_id: int, user: User) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if not ticket or (user.role == ROLE_EXECUTOR and ticket.assignee_id != user.id):
        raise HTTPException(404, "Заявка не найдена")
    return ticket


@router.get("/tickets")
def list_tickets(
    filters: Filters = Depends(),
    sort: str = "new",
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=300),
    user: User = Depends(any_staff),
    db: Session = Depends(get_db),
):
    stmt = filters.apply(_base_query(), user)
    if sort == "old":
        stmt = stmt.order_by(Ticket.created_at.asc())
    elif sort == "updated":
        stmt = stmt.order_by(Ticket.updated_at.desc())
    elif sort == "priority":
        rank = case(PRIORITY_RANK, value=Ticket.priority, else_=9)
        stmt = stmt.order_by(rank, Ticket.created_at.desc())
    else:
        stmt = stmt.order_by(Ticket.created_at.desc())

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    items = db.scalars(_with_relations(stmt).offset((page - 1) * per_page).limit(per_page)).unique().all()

    counts_stmt = filters.apply(
        select(Ticket.status, func.count(Ticket.id)).outerjoin(Location, Ticket.location_id == Location.id),
        user,
        with_status=False,
    ).group_by(Ticket.status)
    counts = dict(db.execute(counts_stmt).all())

    return {
        "items": [ts.ticket_brief(t) for t in items],
        "total": total,
        "page": page,
        "pages": max((total + per_page - 1) // per_page, 1),
        "status_counts": {s: counts.get(s, 0) for s in ts.STATUS_LABELS},
    }


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, user: User = Depends(any_staff), db: Session = Depends(get_db)):
    return ts.ticket_full(_ticket_for(db, ticket_id, user), user)


@router.patch("/tickets/{ticket_id}")
def update_ticket(
    ticket_id: int,
    payload: TicketUpdateIn,
    background: BackgroundTasks,
    user: User = Depends(any_staff),
    db: Session = Depends(get_db),
):
    ticket = _ticket_for(db, ticket_id, user)
    is_executor = user.role == ROLE_EXECUTOR
    if is_executor and (payload.assignee_id or payload.unassign or payload.priority or payload.category_id):
        raise HTTPException(403, "Исполнитель может менять только статус и писать комментарии")

    status_before = ticket.status
    assignee_before = ticket.assignee_id

    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category:
            raise HTTPException(400, "Категория не найдена")
        ts.set_category(db, ticket, category, user)
    if payload.priority:
        ts.set_priority(db, ticket, payload.priority, user)
    if payload.unassign:
        ts.set_assignee(db, ticket, None, user)
    elif payload.assignee_id:
        assignee = db.get(User, payload.assignee_id)
        if not assignee or not assignee.is_active:
            raise HTTPException(400, "Исполнитель не найден")
        ts.set_assignee(db, ticket, assignee, user)
    if payload.status:
        ts.change_status(db, ticket, payload.status, user, payload.note)

    ticket.updated_at = utcnow()
    db.commit()

    if ticket.assignee_id and ticket.assignee_id != assignee_before:
        background.add_task(bot.ticket_changed, ticket.id, "assigned")
    if ticket.status != status_before:
        background.add_task(bot.ticket_changed, ticket.id, "status")
    return ts.ticket_full(ticket, user)


@router.post("/tickets/{ticket_id}/comments")
def comment(
    ticket_id: int,
    payload: CommentIn,
    background: BackgroundTasks,
    user: User = Depends(any_staff),
    db: Session = Depends(get_db),
):
    ticket = _ticket_for(db, ticket_id, user)
    ts.add_comment(db, ticket, payload.body, user, payload.visibility)
    ticket.updated_at = utcnow()
    db.commit()
    if payload.visibility == "public":
        background.add_task(bot.ticket_changed, ticket.id, "comment", payload.body.strip())
    return ts.ticket_full(ticket, user)


@router.get("/attachments/{attachment_id}")
def attachment(attachment_id: int, user: User = Depends(any_staff), db: Session = Depends(get_db)):
    item = db.get(Attachment, attachment_id)
    if not item:
        raise HTTPException(404, "Файл не найден")
    _ticket_for(db, item.ticket_id, user)
    return FileResponse(
        attachment_path(item), media_type=item.file_type, headers={"Cache-Control": "private, max-age=3600"}
    )


@router.get("/assignees")
def assignees(user: User = Depends(any_staff), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(User)
        .where(User.is_active, User.role.in_([ROLE_EXECUTOR, ROLE_STAFF, ROLE_ADMIN]))
        .order_by(User.role.desc(), User.name)
    ).all()
    load = dict(
        db.execute(
            select(Ticket.assignee_id, func.count(Ticket.id))
            .where(Ticket.status.in_(ts.OPEN_STATUSES), Ticket.assignee_id.is_not(None))
            .group_by(Ticket.assignee_id)
        ).all()
    )
    return [
        {"id": u.id, "name": u.name, "position": u.position, "role": u.role, "open_tickets": load.get(u.id, 0)}
        for u in rows
    ]


@router.get("/stats")
def stats(days: int = Query(14, ge=7, le=90), user: User = Depends(upk_staff), db: Session = Depends(get_db)):
    return build_stats(db, days)


@router.get("/map")
def building_map(user: User = Depends(upk_staff), db: Session = Depends(get_db)):
    locations = db.scalars(
        select(Location).where(Location.is_active).order_by(Location.building, Location.floor, Location.room)
    ).all()
    month_ago = utcnow() - timedelta(days=30)
    open_counts = dict(
        db.execute(
            select(Ticket.location_id, func.count(Ticket.id))
            .where(Ticket.status.in_(ts.OPEN_STATUSES))
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
            select(Ticket.location_id).where(Ticket.status.in_(ts.OPEN_STATUSES), Ticket.priority == "critical")
        ).all()
    )

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


EXPORT_COLUMNS = [
    ("Номер", 12),
    ("Создана", 18),
    ("Заголовок", 40),
    ("Описание", 60),
    ("Категория", 24),
    ("Место", 40),
    ("Статус", 20),
    ("Приоритет", 14),
    ("Исполнитель", 24),
    ("Сообщили", 10),
    ("Закрыта", 18),
    ("Оценка", 10),
]


def _export_rows(db: Session, filters: Filters, user: User) -> list[list]:
    stmt = filters.apply(_base_query(), user).order_by(Ticket.created_at.desc()).limit(5000)
    rows = []
    for t in db.scalars(_with_relations(stmt)).unique():
        rows.append(
            [
                t.public_number,
                t.created_at.strftime("%d.%m.%Y %H:%M"),
                t.title,
                t.description,
                t.category.name,
                t.place,
                ts.STATUS_LABELS[t.status],
                ts.PRIORITY_LABELS.get(t.priority, t.priority),
                t.assignee.name if t.assignee else "",
                t.reports_count,
                t.closed_at.strftime("%d.%m.%Y %H:%M") if t.closed_at else "",
                t.rating or "",
            ]
        )
    return rows


@router.get("/export.xlsx")
def export_xlsx(filters: Filters = Depends(), user: User = Depends(upk_staff), db: Session = Depends(get_db)):
    wb = Workbook()
    ws = wb.active
    ws.title = "Заявки"
    ws.append([c[0] for c in EXPORT_COLUMNS])
    for i, (_, width) in enumerate(EXPORT_COLUMNS, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = width
        cell = ws.cell(row=1, column=i)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="2F5BD3")
    for row in _export_rows(db, filters, user):
        ws.append(row)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    name = f"upk-zayavki-{date.today():%Y-%m-%d}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export.csv")
def export_csv(filters: Filters = Depends(), user: User = Depends(upk_staff), db: Session = Depends(get_db)):
    buf = io.StringIO()
    buf.write("﻿")  # BOM, чтобы Excel правильно открыл кириллицу
    writer = csv.writer(buf, delimiter=";")
    writer.writerow([c[0] for c in EXPORT_COLUMNS])
    writer.writerows(_export_rows(db, filters, user))
    name = f"upk-zayavki-{date.today():%Y-%m-%d}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
