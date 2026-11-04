"""Проверка защит вокруг языковой модели. Ответы GigaChat подменяются, сеть не нужна."""

import asyncio
import json

import pytest

from app.ai import assistant
from app.ai.gigachat import GigaChatError
from app.ai.gigachat import client as gigachat
from app.config import settings
from app.db import SessionLocal


@pytest.fixture
def fake_llm(monkeypatch, client):  # client поднимает приложение и базу
    answers = []

    async def chat(messages, **kwargs):
        value = answers.pop(0)
        if isinstance(value, Exception):
            raise value
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)

    monkeypatch.setattr(settings, "gigachat_auth_key", "test-key")
    monkeypatch.setattr(gigachat, "chat", chat)
    return answers


def run(text):
    with SessionLocal() as db:
        return asyncio.run(assistant.analyze(db, text))


def test_answer_with_source_is_kept(fake_llm):
    fake_llm.append(
        {"kind": "question", "category": "equipment", "confidence": 0.9, "answer": "Нажмите Win+P.", "kb_ids": [1]}
    )
    reply = run("как вывести экран на проектор")
    assert reply.kind == "question"
    assert reply.engine == "gigachat"
    assert reply.sources and reply.sources[0]["id"] == 1


def test_answer_without_source_becomes_unknown(fake_llm):
    fake_llm.append({"kind": "question", "confidence": 0.95, "answer": "Столовая работает до 18:00.", "kb_ids": []})
    reply = run("до скольки работает столовая?")
    assert reply.kind == "unknown"
    assert reply.guard == "no_source"
    assert "18:00" not in reply.answer


def test_made_up_source_ids_are_dropped(fake_llm):
    fake_llm.append({"kind": "question", "confidence": 0.9, "answer": "Ответ", "kb_ids": [9999]})
    assert run("какой-то вопрос?").kind == "unknown"


def test_unsafe_advice_from_model_is_blocked(fake_llm):
    fake_llm.append(
        {
            "kind": "fault",
            "category": "electricity",
            "confidence": 0.8,
            "answer": "Отключите автомат в щитке и замените розетку.",
            "tips": ["Возьмите отвертку"],
        }
    )
    reply = run("не работает розетка")
    assert reply.guard == "unsafe_output"
    assert "автомат" not in reply.answer
    assert reply.tips == []
    assert reply.suggest_ticket


def test_invented_contacts_are_removed(fake_llm):
    fake_llm.append(
        {
            "kind": "fault",
            "category": "equipment",
            "confidence": 0.8,
            "answer": "Оформите заявку. Или звоните завхозу по номеру +7 (928) 123-45-67.",
        }
    )
    reply = run("сломался проектор")
    assert "123-45-67" not in reply.answer
    assert reply.guard == "contacts_removed"


def test_low_confidence_goes_to_human(fake_llm):
    fake_llm.append({"kind": "question", "confidence": 0.2, "answer": "Наверное так", "kb_ids": [1]})
    reply = run("как настроить проектор под потолком?")
    assert reply.kind == "unknown"
    assert reply.guard == "low_confidence"


def test_model_danger_uses_fixed_safe_text(fake_llm):
    fake_llm.append({"kind": "danger", "category": "electricity", "confidence": 0.9, "answer": "Разберите удлинитель"})
    reply = run("удлинитель какой-то странный, трещит")
    assert reply.kind == "danger"
    assert "Разберите" not in reply.answer


def test_safety_filter_runs_before_model(fake_llm):
    # модель бы ответила опасно, но до неё дело не доходит
    fake_llm.append({"kind": "fault", "confidence": 0.9, "answer": "Подуйте на розетку"})
    reply = run("из розетки идёт дым")
    assert reply.engine == "safety"
    assert fake_llm, "модель не должна вызываться"


def test_broken_json_falls_back_to_rules(fake_llm):
    fake_llm.append("Извините, я не могу ответить в формате JSON")
    reply = run("В кабинете грязно")
    assert reply.engine == "fallback"
    assert reply.kind == "fault"
    assert reply.notice


def test_api_error_falls_back_to_rules(fake_llm):
    fake_llm.append(GigaChatError("нет связи"))
    reply = run("Как подключить ноутбук к проектору?")
    assert reply.engine == "fallback"
    assert reply.kind == "question"
