from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    # в базе всё хранится в UTC без tzinfo, на фронт уходит с суффиксом Z
    return datetime.now(timezone.utc).replace(tzinfo=None)


ROLE_ADMIN = "admin"
ROLE_STAFF = "staff"
ROLE_EXECUTOR = "executor"
ROLES = {
    ROLE_ADMIN: "Администратор",
    ROLE_STAFF: "Сотрудник УПК",
    ROLE_EXECUTOR: "Исполнитель",
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str | None] = mapped_column(String(120))
    login: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default=ROLE_STAFF)
    password_hash: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    tg_chat_id: Mapped[str | None] = mapped_column(String(32))
    # временный пароль от администратора или команды create_admin: пока не сменён, панель закрыта
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)

    user: Mapped[User] = relationship()


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(255))
    icon: Mapped[str] = mapped_column(String(30), default="other")
    default_priority: Mapped[str] = mapped_column(String(10), default="normal")
    default_assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    sort: Mapped[int] = mapped_column(Integer, default=100)

    default_assignee: Mapped[User | None] = relationship()


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    building: Mapped[str] = mapped_column(String(60))
    floor: Mapped[int | None] = mapped_column(Integer)
    room: Mapped[str | None] = mapped_column(String(20))
    zone_name: Mapped[str | None] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="room")  # room / lab / common
    qr_key: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    @property
    def title(self) -> str:
        if self.room and self.zone_name:
            return f"Кабинет {self.room}, {self.zone_name}"
        if self.room:
            return f"Кабинет {self.room}"
        return self.zone_name or "Без названия"

    @property
    def full_title(self) -> str:
        parts = [self.building]
        if self.floor is not None:
            parts.append(f"{self.floor} этаж")
        parts.append(self.title)
        return ", ".join(parts)


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        # частые выборки панели: список по статусу, открытые заявки помещения и исполнителя
        Index("ix_tickets_status_created_at", "status", "created_at"),
        Index("ix_tickets_location_id_status", "location_id", "status"),
        Index("ix_tickets_assignee_id_status", "assignee_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"), index=True)
    location_note: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    source: Mapped[str] = mapped_column(String(10), default="manual")
    contact: Mapped[str | None] = mapped_column(String(120))
    client_request_id: Mapped[str | None] = mapped_column(String(64), unique=True)

    ai_kind: Mapped[str | None] = mapped_column(String(20))
    ai_engine: Mapped[str | None] = mapped_column(String(20))
    ai_confidence: Mapped[float | None] = mapped_column(Float)

    reports_count: Mapped[int] = mapped_column(Integer, default=1)
    rating: Mapped[int | None] = mapped_column(Integer)
    rating_comment: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)

    category: Mapped[Category] = relationship()
    location: Mapped[Location | None] = relationship()
    assignee: Mapped[User | None] = relationship()
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="ticket", order_by="Comment.created_at", cascade="all, delete-orphan"
    )
    history: Mapped[list["TicketHistory"]] = relationship(
        back_populates="ticket", order_by="TicketHistory.id", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="ticket", order_by="Attachment.id", cascade="all, delete-orphan"
    )
    trackers: Mapped[list["Tracker"]] = relationship(back_populates="ticket", cascade="all, delete-orphan")

    @property
    def public_number(self) -> str:
        return f"УПК-{self.number:04d}"

    @property
    def place(self) -> str:
        if self.location:
            return self.location.full_title
        return self.location_note or "Место не указано"


class Tracker(Base):
    """Доступ заявителя к заявке по коду отслеживания. В базе только хеш кода."""

    __tablename__ = "trackers"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    is_reporter: Mapped[bool] = mapped_column(Boolean, default=True)
    tg_chat_id: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    ticket: Mapped[Ticket] = relationship(back_populates="trackers")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    from_reporter: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(10), default="public")  # public / internal
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    ticket: Mapped[Ticket] = relationship(back_populates="comments")
    author: Mapped[User | None] = relationship()


class TicketHistory(Base):
    __tablename__ = "ticket_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str | None] = mapped_column(String(60))
    action: Mapped[str] = mapped_column(String(20))
    old_value: Mapped[str | None] = mapped_column(String(120))
    new_value: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    ticket: Mapped[Ticket] = relationship(back_populates="history")
    actor: Mapped[User | None] = relationship()


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    original_name: Mapped[str | None] = mapped_column(String(160))
    file_type: Mapped[str] = mapped_column(String(40))
    size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    ticket: Mapped[Ticket] = relationship(back_populates="attachments")


class KnowledgeArticle(Base):
    __tablename__ = "knowledge_base"

    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(String(200))
    answer: Mapped[str] = mapped_column(Text)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    keywords: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(160), default="База знаний УПК")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    category: Mapped[Category | None] = relationship()


class AiLog(Base):
    __tablename__ = "ai_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    message: Mapped[str] = mapped_column(Text)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(20))
    category_code: Mapped[str | None] = mapped_column(String(30))
    confidence: Mapped[float] = mapped_column(Float, default=0)
    engine: Mapped[str] = mapped_column(String(20))
    answer: Mapped[str] = mapped_column(Text, default="")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id", ondelete="SET NULL"), index=True)

    ticket: Mapped[Ticket | None] = relationship()
