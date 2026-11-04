"""Telegram-бот: уведомления сотрудникам и заявителям, кнопки «Взять» и «Начать работу»."""

import asyncio
import html
import logging
import secrets
import time

import httpx
from sqlalchemy import select

from ..config import settings
from ..db import SessionLocal
from ..models import ROLE_ADMIN, ROLE_EXECUTOR, ROLE_STAFF, Ticket, Tracker, User
from ..security import hash_token, normalize_code
from . import tickets as ts

log = logging.getLogger("upk.telegram")

PRIORITY_MARK = {"critical": "🔴", "high": "🟠", "normal": "🔵", "low": "⚪"}


def _e(text: str | None) -> str:
    return html.escape(text or "")


class TelegramBot:
    def __init__(self) -> None:
        self.username: str | None = None
        self._task: asyncio.Task | None = None
        self._client: httpx.AsyncClient | None = None
        self._offset = 0
        self._link_codes: dict[str, tuple[int, float]] = {}

    @property
    def enabled(self) -> bool:
        return settings.telegram_enabled and self.username is not None

    async def _call(self, method: str, **params) -> dict:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=40)
        resp = await self._client.post(f"https://api.telegram.org/bot{settings.telegram_token}/{method}", json=params)
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(f"{method}: {data.get('description')}")
        return data["result"]

    async def start(self) -> None:
        if not settings.telegram_enabled:
            return
        try:
            me = await self._call("getMe")
        except Exception as exc:  # бот не обязателен для работы системы
            log.warning("Telegram-бот не запущен: %s", exc)
            return
        self.username = me["username"]
        self._task = asyncio.create_task(self._poll())
        log.info("Telegram-бот @%s запущен", self.username)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._client:
            await self._client.aclose()
            self._client = None

    # ---------- ссылки ----------

    def tracker_link(self, code: str) -> str | None:
        return f"https://t.me/{self.username}?start={code}" if self.enabled else None

    def staff_link(self, user: User) -> str | None:
        if not self.enabled:
            return None
        now = time.time()
        self._link_codes = {k: v for k, v in self._link_codes.items() if now - v[1] < 900}
        code = "s_" + secrets.token_urlsafe(12).replace("-", "").replace("_", "")[:16]
        self._link_codes[code] = (user.id, now)
        return f"https://t.me/{self.username}?start={code}"

    # ---------- отправка ----------

    async def send(self, chat_id: str, text: str, buttons: list[list[dict]] | None = None) -> None:
        params = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
        if buttons:
            params["reply_markup"] = {"inline_keyboard": buttons}
        try:
            await self._call("sendMessage", **params)
        except Exception as exc:
            log.warning("Не удалось отправить сообщение в %s: %s", chat_id, exc)

    def _panel_button(self, ticket: Ticket) -> list[dict]:
        if settings.public_url.startswith("https://"):
            return [{"text": "Открыть в панели", "url": f"{settings.public_url}/admin#/tickets/{ticket.id}"}]
        return []

    def _ticket_card(self, t: Ticket) -> str:
        return (
            f"{PRIORITY_MARK.get(t.priority, '')} <b>{_e(t.public_number)}</b> · {_e(t.title)}\n"
            f"📍 {_e(t.place)}\n"
            f"🏷 {_e(t.category.name)} · приоритет: {_e(ts.PRIORITY_LABELS.get(t.priority))}\n\n"
            f"{_e(t.description[:500])}"
        )

    async def ticket_created(self, ticket_id: int) -> None:
        if not self.enabled:
            return
        with SessionLocal() as db:
            t = db.get(Ticket, ticket_id)
            if not t:
                return
            text = "🆕 <b>Новая заявка</b>\n" + self._ticket_card(t)
            buttons = [[{"text": "Взять себе", "callback_data": f"take:{t.id}"}, *self._panel_button(t)]]
            recipients = set()
            if settings.telegram_staff_chat_id:
                recipients.add(settings.telegram_staff_chat_id)
            else:
                for u in db.scalars(
                    select(User).where(
                        User.role.in_([ROLE_ADMIN, ROLE_STAFF]), User.is_active, User.tg_chat_id.is_not(None)
                    )
                ):
                    recipients.add(u.tg_chat_id)
            default = t.category.default_assignee
            if default and default.is_active and default.tg_chat_id:
                recipients.add(default.tg_chat_id)
        for chat in recipients:
            await self.send(chat, text, buttons)

    async def ticket_changed(self, ticket_id: int, event: str, comment: str | None = None) -> None:
        if not self.enabled:
            return
        with SessionLocal() as db:
            t = db.get(Ticket, ticket_id)
            if not t:
                return
            reporters = [tr.tg_chat_id for tr in t.trackers if tr.tg_chat_id]
            messages = []
            if event == "status":
                note = None
                for h in reversed(t.history):
                    if h.action == "status":
                        note = h.note if h.new_value in ts.NOTE_REQUIRED else None
                        break
                text = f"📋 Заявка <b>{_e(t.public_number)}</b> «{_e(t.title)}»\nНовый статус: <b>{_e(ts.STATUS_LABELS[t.status])}</b>"
                if note:
                    text += f"\n\n💬 {_e(note)}"
                if t.status == "need_info":
                    text += "\n\nОтветить можно на странице заявки."
                messages = [(chat, text, None) for chat in reporters]
            elif event == "comment" and comment:
                text = f"💬 Сотрудник УПК ответил по заявке <b>{_e(t.public_number)}</b>:\n\n{_e(comment)}"
                messages = [(chat, text, None) for chat in reporters]
            elif event == "assigned" and t.assignee and t.assignee.tg_chat_id:
                text = "🛠 <b>Вам назначена заявка</b>\n" + self._ticket_card(t)
                buttons = [[{"text": "Начать работу", "callback_data": f"start:{t.id}"}, *self._panel_button(t)]]
                messages = [(t.assignee.tg_chat_id, text, buttons)]
        for chat, text, buttons in messages:
            await self.send(chat, text, buttons)

    # ---------- приём сообщений ----------

    async def _poll(self) -> None:
        while True:
            try:
                updates = await self._call(
                    "getUpdates", offset=self._offset, timeout=25, allowed_updates=["message", "callback_query"]
                )
                for update in updates:
                    self._offset = update["update_id"] + 1
                    try:
                        await self._handle(update)
                    except Exception:
                        log.exception("Ошибка обработки обновления Telegram")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("getUpdates: %s", exc)
                await asyncio.sleep(5)

    async def _handle(self, update: dict) -> None:
        if "callback_query" in update:
            await self._handle_callback(update["callback_query"])
            return
        message = update.get("message") or {}
        chat_id = str(message.get("chat", {}).get("id", ""))
        text = (message.get("text") or "").strip()
        if not chat_id or not text:
            return
        if text.startswith("/start"):
            arg = text.removeprefix("/start").strip()
            if arg.startswith("s_"):
                await self._link_staff(chat_id, arg)
            elif arg:
                await self._link_tracker(chat_id, arg)
            else:
                await self.send(
                    chat_id,
                    "Привет! Я бот цифрового помощника УПК.\n\nЧтобы следить за заявкой, откройте её страницу "
                    "и нажмите «Уведомления в Telegram». Сотрудники подключают бота в своём профиле в панели.",
                )
        elif text.startswith("/status"):
            await self._send_statuses(chat_id)

    async def _link_tracker(self, chat_id: str, raw_code: str) -> None:
        with SessionLocal() as db:
            tracker = db.scalar(select(Tracker).where(Tracker.token_hash == hash_token(normalize_code(raw_code))))
            if not tracker:
                await self.send(chat_id, "Заявка не найдена. Проверьте ссылку.")
                return
            tracker.tg_chat_id = chat_id
            db.commit()
            t = tracker.ticket
            text = (
                f"✅ Подписал вас на заявку <b>{_e(t.public_number)}</b> «{_e(t.title)}».\n"
                f"Сейчас статус: <b>{_e(ts.STATUS_LABELS[t.status])}</b>.\n\n"
                "Напишу, когда что-то изменится. Все ваши заявки: /status"
            )
        await self.send(chat_id, text)

    async def _link_staff(self, chat_id: str, code: str) -> None:
        entry = self._link_codes.pop(code, None)
        if not entry or time.time() - entry[1] > 900:
            await self.send(chat_id, "Ссылка устарела. Получите новую в профиле в панели УПК.")
            return
        with SessionLocal() as db:
            user = db.get(User, entry[0])
            if not user or not user.is_active:
                return
            user.tg_chat_id = chat_id
            db.commit()
            name = user.name
        await self.send(chat_id, f"✅ {_e(name)}, Telegram подключён. Сюда будут приходить заявки и назначения.")

    async def _send_statuses(self, chat_id: str) -> None:
        with SessionLocal() as db:
            trackers = db.scalars(select(Tracker).where(Tracker.tg_chat_id == chat_id)).all()
            if not trackers:
                text = "У вас нет подписок на заявки."
            else:
                lines = [
                    f"• <b>{_e(tr.ticket.public_number)}</b> {_e(tr.ticket.title)}: {_e(ts.STATUS_LABELS[tr.ticket.status])}"
                    for tr in trackers[-10:]
                ]
                text = "Ваши заявки:\n" + "\n".join(lines)
        await self.send(chat_id, text)

    async def _handle_callback(self, query: dict) -> None:
        data = query.get("data", "")
        chat_id = str(query.get("from", {}).get("id", ""))
        answer = "Готово"
        notify: tuple[int, str] | None = None
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.tg_chat_id == chat_id, User.is_active))
            action, _, raw_id = data.partition(":")
            ticket = db.get(Ticket, int(raw_id)) if raw_id.isdigit() else None
            if not user:
                answer = "Сначала подключите Telegram в профиле панели УПК"
            elif not ticket:
                answer = "Заявка не найдена"
            elif action == "take":
                if user.role not in (ROLE_ADMIN, ROLE_STAFF, ROLE_EXECUTOR):
                    answer = "Нет прав"
                elif ticket.assignee_id and ticket.assignee_id != user.id:
                    answer = f"Заявку уже взял(а) {ticket.assignee.name}"
                elif ticket.status in ts.CLOSED_STATUSES:
                    answer = "Заявка уже закрыта"
                else:
                    ts.set_assignee(db, ticket, user, user)
                    db.commit()
                    answer = f"{ticket.public_number} теперь ваша"
                    notify = (ticket.id, "status")
            elif action == "start":
                if ticket.assignee_id != user.id:
                    answer = "Эта заявка назначена не вам"
                elif ticket.status == "in_progress":
                    answer = "Уже в работе"
                else:
                    try:
                        ts.change_status(db, ticket, "in_progress", user, None)
                        db.commit()
                        answer = "Статус: В работе"
                        notify = (ticket.id, "status")
                    except Exception as exc:
                        db.rollback()
                        answer = getattr(exc, "detail", "Не получилось сменить статус")
        try:
            await self._call("answerCallbackQuery", callback_query_id=query["id"], text=answer[:190])
        except Exception:
            pass
        if notify:
            await self.ticket_changed(*notify)


bot = TelegramBot()
