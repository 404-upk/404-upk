"""Устойчивость запросов к модели: предохранитель после серии сбоев и кэш одинаковых вопросов."""

import copy
import time
from collections import OrderedDict

from .reply import AssistantReply


class Breaker:
    """После нескольких сбоев подряд перестаёт ждать модель и на время отдаёт ответы правилам."""

    def __init__(self, limit: int = 3, cooldown: float = 60.0) -> None:
        self.limit = limit
        self.cooldown = cooldown
        self.failures = 0
        self.open_until = 0.0

    @property
    def is_open(self) -> bool:
        return time.monotonic() < self.open_until

    def success(self) -> None:
        self.failures = 0

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.limit:
            self.open_until = time.monotonic() + self.cooldown
            self.failures = 0

    def reset(self) -> None:
        self.failures = 0
        self.open_until = 0.0


class ReplyCache:
    """Одинаковый вопрос из того же места в течение часа не отправляется в модель второй раз."""

    def __init__(self, ttl: float = 3600.0, size: int = 500) -> None:
        self.ttl = ttl
        self.size = size
        self._items: OrderedDict[tuple, tuple[float, AssistantReply]] = OrderedDict()

    def get(self, key: tuple) -> AssistantReply | None:
        item = self._items.get(key)
        if not item:
            return None
        stored, reply = item
        if time.monotonic() - stored > self.ttl:
            self._items.pop(key, None)
            return None
        self._items.move_to_end(key)
        return copy.deepcopy(reply)

    def put(self, key: tuple, reply: AssistantReply) -> None:
        self._items[key] = (time.monotonic(), copy.deepcopy(reply))
        self._items.move_to_end(key)
        while len(self._items) > self.size:
            self._items.popitem(last=False)

    def clear(self) -> None:
        self._items.clear()


breaker = Breaker()
cache = ReplyCache()
