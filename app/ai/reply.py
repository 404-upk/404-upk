from dataclasses import asdict, dataclass, field

KINDS = ("question", "fault", "danger", "unclear", "unknown", "secret")

KIND_LABELS = {
    "question": "Вопрос",
    "fault": "Неисправность",
    "danger": "Опасная ситуация",
    "unclear": "Нужно уточнить",
    "unknown": "Нет проверенной информации",
    "secret": "Закрытые данные",
}

ENGINE_LABELS = {
    "gigachat": "GigaChat",
    "fallback": "Правила (демо-режим)",
    "rules": "База знаний и правила",
    "safety": "Фильтр безопасности",
}


@dataclass
class AssistantReply:
    kind: str
    answer: str
    category: str | None = None
    confidence: float = 0.0
    tips: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    suggest_ticket: bool = False
    draft_title: str = ""
    draft_description: str = ""
    clarify_question: str | None = None
    missing: list[str] = field(default_factory=list)
    priority: str = "normal"
    engine: str = "fallback"
    notice: str | None = None
    guard: str | None = None
    room_hint: str | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["kind_label"] = "Помощник" if self.guard == "smalltalk" else KIND_LABELS.get(self.kind, self.kind)
        data["engine_label"] = ENGINE_LABELS.get(self.engine, self.engine)
        return data
