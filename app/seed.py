"""Начальные данные: категории, помещения, база знаний и демо-аккаунты.

Запуск вручную:  python -m app.seed --reset        (пересоздать базу)
                 python -m app.seed --reset --clean (без демо-заявок)
"""

import argparse
import random
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal, init_db, reset_db
from .models import (
    ROLE_ADMIN,
    ROLE_EXECUTOR,
    ROLE_STAFF,
    AiLog,
    Category,
    Comment,
    KnowledgeArticle,
    Location,
    Ticket,
    TicketHistory,
    Tracker,
    User,
    utcnow,
)
from .security import hash_password, hash_token, new_tracking_code
from .seed_data import (
    ARTICLES,
    CATEGORIES,
    CLOSING_NOTES,
    DEMO_AI_QUESTIONS,
    DEMO_TICKETS,
    LOCATIONS,
    USERS,
)


def seed_reference(db: Session, demo_users: bool = True) -> None:
    """Справочники и база знаний. Демо-аккаунты создаются только вне боевого режима: на сервере первого
    администратора заводят командой python -m app.create_admin."""
    if db.scalar(select(func.count(Category.id))):
        return

    users = {}
    if demo_users:
        passwords = {
            ROLE_ADMIN: settings.demo_admin_password,
            ROLE_STAFF: settings.demo_staff_password,
            ROLE_EXECUTOR: settings.demo_executor_password,
        }
        for login, name, position, role in USERS:
            user = User(
                login=login, name=name, position=position, role=role, password_hash=hash_password(passwords[role])
            )
            db.add(user)
            users[login] = user
        db.flush()

    categories = {}
    for sort, (code, name, desc, icon, priority, assignee) in enumerate(CATEGORIES):
        category = Category(
            code=code,
            name=name,
            description=desc,
            icon=icon,
            default_priority=priority,
            default_assignee_id=users[assignee].id if assignee in users else None,
            sort=sort,
        )
        db.add(category)
        categories[code] = category
    db.flush()

    for building, floor, room, zone, kind, key in LOCATIONS:
        db.add(Location(building=building, floor=floor, room=room, zone_name=zone, kind=kind, qr_key=key))

    for question, answer, category, keywords, source in ARTICLES:
        db.add(
            KnowledgeArticle(
                question=question,
                answer=answer,
                category_id=categories[category].id if category else None,
                keywords=keywords,
                source=source,
            )
        )
    db.commit()


def seed_demo_tickets(db: Session) -> None:
    if db.scalar(select(func.count(Ticket.id))):
        return
    rnd = random.Random(42)
    now = utcnow()
    users = {u.login: u for u in db.scalars(select(User)).all()}
    categories = {c.code: c for c in db.scalars(select(Category)).all()}
    locations = {loc.qr_key: loc for loc in db.scalars(select(Location)).all()}
    staff = users["upk"]

    for number, row in enumerate(DEMO_TICKETS, start=1):
        days, title, description, cat, loc, path, assignee, close_hours, rating, reports, priority = row
        created = now - timedelta(days=days, minutes=rnd.randint(0, 300))
        ticket = Ticket(
            number=number,
            title=title,
            description=description,
            category=categories[cat],
            location=locations[loc],
            status="new",
            priority=priority,
            source=rnd.choice(["qr", "qr", "manual"]),
            ai_kind="fault",
            ai_engine="fallback",
            ai_confidence=round(rnd.uniform(0.62, 0.9), 2),
            reports_count=reports,
            created_at=created,
            updated_at=created,
        )
        db.add(ticket)
        db.add(Tracker(ticket=ticket, token_hash=hash_token(new_tracking_code()), created_at=created))
        db.add(
            TicketHistory(ticket=ticket, action="created", new_value="new", actor_label="Заявитель", created_at=created)
        )
        db.add(
            AiLog(
                created_at=created - timedelta(minutes=1),
                message=description,
                location_id=locations[loc].id,
                kind="fault",
                category_code=cat,
                confidence=ticket.ai_confidence,
                engine="fallback",
                answer="Похоже на неисправность, тут нужен сотрудник.",
                latency_ms=rnd.randint(8, 40),
                ticket=ticket,
            )
        )
        for extra in range(reports - 1):
            db.add(
                TicketHistory(
                    ticket=ticket,
                    action="joined",
                    new_value=str(extra + 2),
                    actor_label="Заявитель",
                    created_at=created + timedelta(minutes=20 * (extra + 1)),
                )
            )

        moment = created
        steps = len(path)
        total_hours = close_hours or max(days * 24 * 0.6, 0.5)
        old = "new"
        for i, status in enumerate(path):
            moment = created + timedelta(hours=total_hours * (i + 1) / steps)
            if status == "assigned" and assignee:
                ticket.assignee = users[assignee]
                db.add(
                    TicketHistory(
                        ticket=ticket,
                        actor_id=staff.id,
                        actor_label=staff.name,
                        action="assignee",
                        new_value=users[assignee].name,
                        is_public=False,
                        created_at=moment,
                    )
                )
            note = rnd.choice(CLOSING_NOTES[status]) if status in CLOSING_NOTES else None
            actor = users[assignee] if status == "in_progress" and assignee else staff
            db.add(
                TicketHistory(
                    ticket=ticket,
                    actor_id=actor.id,
                    actor_label=actor.name,
                    action="status",
                    old_value=old,
                    new_value=status,
                    note=note,
                    created_at=moment,
                )
            )
            if status == "in_progress":
                db.add(
                    Comment(
                        ticket=ticket,
                        author_id=actor.id,
                        visibility="public",
                        created_at=moment,
                        body="Приняли в работу, специалист уже в курсе.",
                    )
                )
            old = status
            ticket.status = status
            if status in ("resolved", "rejected"):
                ticket.closed_at = moment
        ticket.updated_at = moment
        if rating and ticket.status == "resolved":
            ticket.rating = rating
            db.add(
                TicketHistory(
                    ticket=ticket,
                    action="rated",
                    new_value=str(rating),
                    actor_label="Заявитель",
                    created_at=moment + timedelta(hours=2),
                )
            )

    for i, (text, kind, cat) in enumerate(DEMO_AI_QUESTIONS):
        db.add(
            AiLog(
                created_at=now - timedelta(days=rnd.uniform(0, 10), minutes=i),
                message=text,
                kind=kind,
                category_code=cat,
                confidence=1.0 if kind in ("danger", "secret") else round(rnd.uniform(0.7, 0.95), 2),
                engine="safety" if kind in ("danger", "secret") else "fallback",
                answer="",
                latency_ms=rnd.randint(5, 30),
            )
        )
    db.commit()


def seed(db: Session, demo_tickets: bool = True, demo_users: bool = True) -> None:
    seed_reference(db, demo_users)
    if demo_tickets and demo_users:
        seed_demo_tickets(db)


def main() -> None:
    parser = argparse.ArgumentParser(description="Заполнить базу начальными данными")
    parser.add_argument("--reset", action="store_true", help="удалить все данные и создать заново")
    parser.add_argument("--clean", action="store_true", help="без демонстрационных заявок")
    args = parser.parse_args()

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if args.reset:
        reset_db()
    init_db()
    with SessionLocal() as db:
        seed(db, demo_tickets=not args.clean, demo_users=not settings.is_production)
    if settings.is_production:
        print("Готово. Первого администратора создайте командой: python -m app.create_admin")
    else:
        print("Готово. Логины: admin, upk, electric, it, service, cleaning")


if __name__ == "__main__":
    main()
