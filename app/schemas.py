from typing import Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)


class AssistantIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    location_id: int | None = None
    context: list[str] = Field(default_factory=list, max_length=5)


class SimilarIn(BaseModel):
    location_id: int | None = None
    category: str | None = None
    text: str = Field(default="", max_length=2000)


class JoinIn(BaseModel):
    location_id: int


class TicketUpdateIn(BaseModel):
    status: str | None = None
    note: str | None = Field(default=None, max_length=2000)
    assignee_id: int | None = None
    unassign: bool = False
    priority: Literal["low", "normal", "high", "critical"] | None = None
    category_id: int | None = None


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    visibility: Literal["public", "internal"] = "public"


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class RateIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class UserIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    position: str | None = Field(default=None, max_length=120)
    login: str = Field(min_length=3, max_length=60, pattern=r"^[a-zA-Z0-9_.-]+$")
    role: Literal["admin", "staff", "executor"]
    password: str = Field(min_length=8, max_length=200)


class UserUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    position: str | None = Field(default=None, max_length=120)
    role: Literal["admin", "staff", "executor"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)


class LocationIn(BaseModel):
    building: str = Field(min_length=1, max_length=60)
    floor: int | None = Field(default=None, ge=-3, le=50)
    room: str | None = Field(default=None, max_length=20)
    zone_name: str | None = Field(default=None, max_length=80)
    kind: Literal["room", "lab", "common"] = "room"
    is_active: bool = True


class CategoryUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=255)
    default_priority: Literal["low", "normal", "high", "critical"] | None = None
    default_assignee_id: int | None = None
    clear_assignee: bool = False


class ArticleIn(BaseModel):
    question: str = Field(min_length=3, max_length=200)
    answer: str = Field(min_length=10, max_length=4000)
    category_id: int | None = None
    keywords: str = Field(default="", max_length=2000)
    source: str = Field(default="База знаний УПК", max_length=160)
    is_active: bool = True
