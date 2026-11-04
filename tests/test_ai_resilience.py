"""Устойчивость к сбоям GigaChat: предохранитель, кэш и повторы запроса. Сеть не нужна."""

import asyncio
import json
import time

import httpx
import pytest

from app.ai import assistant, resilience
from app.ai.gigachat import GigaChatClient, GigaChatError
from app.ai.gigachat import client as gigachat
from app.config import settings
from app.db import SessionLocal

ANSWER = {"kind": "fault", "category": "equipment", "confidence": 0.9, "answer": "Оформите заявку."}


@pytest.fixture
def model(monkeypatch, client):  # client поднимает приложение и базу
    calls = []
    answers = []

    async def chat(messages, **kwargs):
        calls.append(messages)
        value = answers.pop(0) if answers else ANSWER
        if isinstance(value, Exception):
            raise value
        return json.dumps(value, ensure_ascii=False)

    monkeypatch.setattr(settings, "gigachat_auth_key", "test-key")
    monkeypatch.setattr(gigachat, "chat", chat)
    return calls, answers


def run(text, location=None):
    with SessionLocal() as db:
        return asyncio.run(assistant.analyze(db, text, location))


def test_breaker_opens_after_series_of_failures(model):
    calls, answers = model
    answers.extend([GigaChatError("нет связи")] * 3)
    for _ in range(3):
        assert run("в 214 не работает проектор").notice == assistant.FALLBACK_NOTICE
    assert len(calls) == 3
    assert resilience.breaker.is_open

    started = time.perf_counter()
    reply = run("в 305 сломался стул")
    assert time.perf_counter() - started < 1
    assert len(calls) == 3, "пока предохранитель открыт, модель не вызывается"
    assert reply.notice == assistant.FALLBACK_NOTICE
    assert reply.kind == "fault"


def test_breaker_closes_after_cooldown(model, monkeypatch):
    calls, answers = model
    answers.extend([GigaChatError("нет связи")] * 3)
    for _ in range(3):
        run("в 214 не работает проектор")
    assert resilience.breaker.is_open
    monkeypatch.setattr(resilience.breaker, "open_until", time.monotonic() - 1)
    reply = run("в 305 сломался стул")
    assert reply.engine == "gigachat"
    assert len(calls) == 4


def test_bad_model_answer_does_not_open_breaker(model):
    calls, answers = model
    answers.extend(["не JSON"] * 5)
    for _ in range(5):
        run("в 214 не работает проектор")
    assert not resilience.breaker.is_open


def test_health_shows_degraded_mode(model, client):
    _, answers = model
    answers.extend([GigaChatError("нет связи")] * 3)
    for _ in range(3):
        run("в 214 не работает проектор")
    assert client.get("/api/health").json()["ai"] == "degraded"


def test_same_question_is_answered_from_cache(model):
    calls, _ = model
    first = run("в 214 не работает проектор")
    second = run("В 214 не работает проектор")
    assert len(calls) == 1
    assert first.answer == second.answer
    second.answer = "изменили копию"
    assert run("в 214 не работает проектор").answer != "изменили копию"


def test_cache_depends_on_place(model):
    calls, _ = model
    with SessionLocal() as db:
        from app.models import Location

        rooms = db.query(Location).limit(2).all()
        asyncio.run(assistant.analyze(db, "не работает проектор", rooms[0]))
        asyncio.run(assistant.analyze(db, "не работает проектор", rooms[1]))
    assert len(calls) == 2


def test_fallback_answers_are_not_cached(model):
    calls, answers = model
    answers.append(GigaChatError("нет связи"))
    assert run("в 214 не работает проектор").notice == assistant.FALLBACK_NOTICE
    assert run("в 214 не работает проектор").engine == "gigachat"
    assert len(calls) == 2


def test_knowledge_base_change_clears_cache(model, client):
    from .conftest import login

    calls, _ = model
    run("в 214 не работает проектор")
    login(client)
    article = client.get("/api/manage/kb").json()[0]
    client.put(
        f"/api/manage/kb/{article['id']}", json={**article, "keywords": article["keywords"] + ", проектор не светит"}
    )
    run("в 214 не работает проектор")
    assert len(calls) == 2


# ---------- повторы запроса в клиенте GigaChat ----------


def make_client(handler) -> GigaChatClient:
    c = GigaChatClient()
    c._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def token():
        return "token"

    c._get_token = token
    return c


OK = {"choices": [{"message": {"content": "{}"}}]}


@pytest.fixture(autouse=True)
def _no_pause(monkeypatch):
    from app.ai import gigachat as module

    monkeypatch.setattr(module, "RETRY_PAUSE", 0)


def test_retry_after_temporary_server_error():
    hits = []

    def handler(request):
        hits.append(1)
        return httpx.Response(503) if len(hits) == 1 else httpx.Response(200, json=OK)

    assert asyncio.run(make_client(handler).chat([])) == "{}"
    assert len(hits) == 2


def test_retry_after_connection_drop():
    hits = []

    def handler(request):
        hits.append(1)
        if len(hits) == 1:
            raise httpx.ConnectError("обрыв")
        return httpx.Response(200, json=OK)

    assert asyncio.run(make_client(handler).chat([])) == "{}"
    assert len(hits) == 2


def test_no_retry_after_slow_answer():
    hits = []

    def handler(request):
        hits.append(1)
        raise httpx.ReadTimeout("долго")

    with pytest.raises(GigaChatError):
        asyncio.run(make_client(handler).chat([]))
    assert len(hits) == 1


def test_only_one_retry():
    hits = []

    def handler(request):
        hits.append(1)
        return httpx.Response(502)

    with pytest.raises(GigaChatError):
        asyncio.run(make_client(handler).chat([]))
    assert len(hits) == 2


def test_client_error_is_not_retried():
    hits = []

    def handler(request):
        hits.append(1)
        return httpx.Response(400, text="плохой запрос")

    with pytest.raises(GigaChatError):
        asyncio.run(make_client(handler).chat([]))
    assert len(hits) == 1
