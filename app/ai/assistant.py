import json
import logging
import re

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Category, Location
from ..security import RateLimiter
from ..services.uploads import normalize_image
from . import resilience, rules, safety
from .gigachat import GigaChatError, client
from .knowledge import Article, load_articles
from .prompts import PHOTO_SYSTEM, system_prompt, user_prompt
from .reply import KINDS, AssistantReply
from .text import extract_room, mask_personal

REPEATED_UNCLEAR_ANSWER = "Пока не могу понять, о какой проблеме речь. Напишите, что сломалось или не работает."
model_budget = RateLimiter(limit=settings.model_requests_per_minute, window=60)

log = logging.getLogger("upk.ai")

DEMO_NOTICE = "Демо-режим: GigaChat не подключён, ответ подготовлен по встроенным правилам и базе знаний."
FALLBACK_NOTICE = "GigaChat сейчас не ответил, поэтому ответ подготовлен по встроенным правилам."

UNKNOWN_ANSWER = (
    "Проверенной информации по этому вопросу у меня нет, поэтому не буду гадать. "
    "Обратитесь к ответственному сотруднику УПК или оставьте обращение, и вам ответит человек."
)
ASKS_PLACE = re.compile(r"укажите[^.]*(кабинет|мест|помещени)")

LOW_CONFIDENCE_ANSWER = (
    "Я не уверен в ответе, поэтому лучше передать вопрос сотруднику. Оставьте обращение, и вам ответит человек."
)


def _categories(db: Session) -> list[Category]:
    return list(db.scalars(select(Category).order_by(Category.sort)).all())


def _parse_json(raw: str) -> dict:
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("в ответе модели нет JSON")
    return json.loads(raw[start : end + 1])


def _as_text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _from_llm(data: dict, articles: list[Article], codes: set[str], has_location: bool, text: str) -> AssistantReply:
    kind = data.get("kind") if data.get("kind") in KINDS else "unknown"
    category = data.get("category") if data.get("category") in codes else None
    try:
        confidence = max(0.0, min(float(data.get("confidence", 0.5)), 1.0))
    except (TypeError, ValueError):
        confidence = 0.5

    by_id = {a.id: a for a in articles}
    kb_ids = []
    for raw_id in data.get("kb_ids") or []:
        try:
            if int(raw_id) in by_id:
                kb_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue

    reply = AssistantReply(
        kind=kind,
        answer=_as_text(data.get("answer"), 1200),
        category=category,
        confidence=round(confidence, 2),
        tips=[_as_text(t, 200) for t in (data.get("tips") or []) if str(t).strip()][:4],
        sources=[by_id[i].as_source() for i in kb_ids],
        draft_title=_as_text(data.get("draft_title"), 100),
        draft_description=_as_text(data.get("draft_description"), 1500),
        clarify_question=_as_text(data.get("clarify_question"), 300) or None,
        missing=[m for m in (data.get("missing") or []) if m in ("place", "problem")],
        engine="gigachat",
        room_hint=extract_room(text),
    )

    if kind == "danger":
        safe = rules.safety_reply(safety.DANGER, text)
        safe.category = category or safe.category
        safe.engine = "gigachat"
        safe.guard = "danger_model"
        return safe
    if kind == "secret":
        return rules.safety_reply(safety.SECRET, text)

    # ответ «по базе знаний» без единой ссылки на статью считаем выдумкой
    if kind == "question" and not reply.sources:
        reply.kind = "unknown"
        reply.answer = UNKNOWN_ANSWER
        reply.tips = []
        reply.guard = "no_source"
    elif kind == "question":
        # модель выбирает статью, но текст берётся из базы: так ответ нельзя выдумать
        reply.answer = by_id[kb_ids[0]].answer[:1200]

    if kind == "unknown":
        reply.answer = UNKNOWN_ANSWER
        reply.tips = []

    if kind == "unclear" and not reply.clarify_question:
        reply.clarify_question = "Что именно случилось и где? Например: «В кабинете 214 не работает проектор»."

    if kind == "fault":
        reply.category = reply.category or "other"
        reply.suggest_ticket = True
        if not reply.draft_title or not reply.draft_description:
            title, description = rules.make_draft(text, reply.category)
            reply.draft_title = reply.draft_title or title
            reply.draft_description = reply.draft_description or description
        if has_location or reply.room_hint:
            reply.missing = [m for m in reply.missing if m != "place"]
        elif "place" not in reply.missing:
            reply.missing.append("place")

    reply.priority = rules.suggest_priority(reply.kind, reply.category, text)

    if reply.confidence < settings.ai_min_confidence:
        if reply.kind == "question":
            reply.kind = "unknown"
            reply.answer = LOW_CONFIDENCE_ANSWER
            reply.guard = "low_confidence"
        elif reply.kind == "fault":
            reply.notice = "ИИ не уверен в категории, сотрудник проверит её при разборе заявки."
    return reply


def _reconcile(model: AssistantReply, rule: AssistantReply) -> AssistantReply:
    """Правила и база знаний страхуют модель там, где они надёжнее её."""
    # в базе знаний есть готовый ответ, а модель его не нашла или не сослалась на него
    if rule.kind == "question" and rule.sources and not (model.kind == "question" and model.sources):
        rule.engine = "rules"
        return rule
    # сообщение слишком размытое: лучше переспросить, чем гадать
    if rule.kind == "unclear" and model.kind in ("fault", "unknown"):
        rule.engine = "rules"
        return rule
    # правила уверенно видят проблему, которую модель не распознала
    if rule.kind == "fault" and rule.confidence >= 0.6 and model.kind in ("unknown", "unclear"):
        rule.engine = "rules"
        return rule
    if model.kind == "fault" and not model.category and rule.category:
        model.category = rule.category
    # место уже известно, а модель всё равно его переспрашивает
    if model.kind == "fault" and "place" not in model.missing and ASKS_PLACE.search(model.answer.lower()):
        model.answer = (
            rule.answer
            if rule.kind == "fault"
            else "Похоже на неисправность. Проверьте черновик заявки и отправьте его."
        )
    return model


def _model_budget_left() -> bool:
    try:
        model_budget.check("all")
    except HTTPException:
        return False
    return True


def _apply_guards(reply: AssistantReply, articles: list[Article]) -> AssistantReply:
    if reply.engine == "safety":
        return reply
    texts = [reply.answer, *reply.tips]
    # модель пересказала свои инструкции: такой ответ не показываем
    if any(safety.leaks_prompt(t) for t in texts):
        reply.kind = "unknown"
        reply.answer = UNKNOWN_ANSWER
        reply.tips = []
        reply.sources = []
        reply.guard = "prompt_leak"
        return reply
    # модель не может менять заявки, поэтому «я закрыл заявку» всегда неправда
    if any(safety.claims_action(t) for t in texts):
        reply.answer = safety.INJECTION_ANSWER
        reply.tips = []
        reply.guard = "fake_action"
        return reply
    # текст статьи проверен людьми, а всё, что написала модель, проверяем на сроки и выдуманных людей
    written = reply.tips if reply.kind == "question" else texts
    if any(safety.is_unsafe_advice(t) for t in texts) or any(
        safety.promises_deadline(t) or safety.invents_person(t) for t in written
    ):
        reply.answer = safety.SAFE_FALLBACK_ANSWER
        reply.tips = []
        reply.suggest_ticket = True
        reply.guard = "unsafe_output"
        if not reply.draft_title:
            reply.draft_title = rules.DEFAULT_TITLES.get(reply.category or "other", "Обращение в УПК")
        return reply

    allowed = " ".join(a.answer for a in articles)
    reply.answer, removed = safety.strip_unverified_contacts(reply.answer, allowed)
    cleaned_tips = []
    for tip in reply.tips:
        tip, tip_removed = safety.strip_unverified_contacts(tip, allowed)
        removed = removed or tip_removed
        if tip:
            cleaned_tips.append(tip)
    reply.tips = cleaned_tips
    if removed:
        reply.guard = reply.guard or "contacts_removed"
    if not reply.answer:
        reply.answer = UNKNOWN_ANSWER if reply.kind in ("question", "unknown") else safety.SAFE_FALLBACK_ANSWER
    return reply


async def analyze(
    db: Session,
    message: str,
    location: Location | None = None,
    context: list[str] | None = None,
    use_llm: bool = True,
    use_cache: bool = True,
) -> AssistantReply:
    text = re.sub(r"\s+", " ", message).strip()
    earlier = [re.sub(r"\s+", " ", c).strip() for c in (context or []) if c.strip()][-3:]
    # в заявку и в модель идут только сообщения по сути проблемы
    context = [c for c in earlier if rules.is_relevant(c)]
    full_text = " ".join([*context, text])

    flag = safety.detect(text) or safety.detect(full_text)
    if flag:
        return rules.safety_reply(flag, full_text)

    articles = load_articles(db)
    has_location = location is not None
    cache_key = (full_text.lower(), location.id if location else None)

    if use_llm and client.enabled and use_cache and (cached := resilience.cache.get(cache_key)):
        return cached

    if use_llm and client.enabled and resilience.breaker.is_open:
        # GigaChat недавно не ответил несколько раз подряд: не ждём таймаут, сразу отвечаем по правилам
        reply = rules.analyze(full_text, articles, has_location, bool(earlier))
        reply.notice = FALLBACK_NOTICE
    elif use_llm and client.enabled and not _model_budget_left():
        # слишком много запросов разом: платная модель подождёт, отвечают правила
        reply = rules.analyze(full_text, articles, has_location, bool(earlier))
        reply.notice = FALLBACK_NOTICE
    elif use_llm and client.enabled:
        categories = _categories(db)
        try:
            raw = await client.chat(
                [
                    {
                        "role": "system",
                        "content": system_prompt([(c.code, c.name, c.description or "") for c in categories], articles),
                    },
                    {
                        "role": "user",
                        # во внешнюю модель личные данные не уходят
                        "content": user_prompt(
                            mask_personal(text),
                            location.full_title if location else None,
                            [mask_personal(c) for c in context],
                        ),
                    },
                ]
            )
            resilience.breaker.success()
            reply = _from_llm(_parse_json(raw), articles, {c.code for c in categories}, has_location, full_text)
            reply = _reconcile(reply, rules.analyze(full_text, articles, has_location, bool(earlier)))
        except (GigaChatError, ValueError, KeyError) as exc:
            # сбоем связи считается только ошибка GigaChat; кривой ответ модели предохранитель не включает
            if isinstance(exc, GigaChatError):
                resilience.breaker.failure()
            log.warning("GigaChat недоступен, работаем по правилам: %s", exc)
            reply = rules.analyze(full_text, articles, has_location, bool(earlier))
            reply.notice = FALLBACK_NOTICE
    else:
        reply = rules.analyze(full_text, articles, has_location, bool(earlier))
        reply.notice = DEMO_NOTICE

    if reply.kind in ("fault", "danger") and reply.priority == "normal":
        reply.priority = rules.suggest_priority(reply.kind, reply.category, full_text)
    if reply.kind == "unclear" and earlier:
        # одна и та же фраза второй раз подряд выглядит как сбой
        reply.answer = REPEATED_UNCLEAR_ANSWER
    reply = _apply_guards(reply, articles)
    # в кэш попадают только ответы модели: запасные ответы должны смениться настоящими, как только GigaChat вернётся
    if reply.notice is None and use_llm and client.enabled and use_cache:
        resilience.cache.put(cache_key, reply)
    return reply


async def analyze_photo(db: Session, data: bytes) -> dict:
    if not client.enabled:
        return {
            "available": False,
            "notice": "Распознавание фото включается вместе с GigaChat. Сейчас фото просто прикрепится к заявке.",
        }
    jpeg, _, _ = await run_in_threadpool(normalize_image, data)
    categories = _categories(db)
    codes = {c.code for c in categories}
    file_id = None
    try:
        file_id = await client.upload_image(jpeg)
        raw = await client.chat(
            [
                {
                    "role": "system",
                    "content": PHOTO_SYSTEM.format(categories=", ".join(f"{c.code} ({c.name})" for c in categories)),
                },
                {"role": "user", "content": "Что на фото и в чём проблема?", "attachments": [file_id]},
            ],
            model=settings.gigachat_vision_model,
        )
        data = _parse_json(raw)
    except (GigaChatError, ValueError, KeyError) as exc:
        log.warning("Не удалось распознать фото: %s", exc)
        return {"available": False, "notice": "Не получилось распознать фото, опишите проблему словами."}
    finally:
        if file_id:
            await client.delete_file(file_id)

    description = _as_text(data.get("description"), 400)
    danger = bool(data.get("danger")) or safety.detect(description) == safety.DANGER
    if safety.is_unsafe_advice(description):
        description = ""
    return {
        "available": True,
        "description": description,
        "category": data.get("category") if data.get("category") in codes else None,
        "danger": danger,
        "confidence": data.get("confidence"),
    }
