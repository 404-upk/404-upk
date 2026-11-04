import re

_WORD = re.compile(r"[а-яa-z0-9]+(?:-[а-яa-z0-9]+)*")

STOP_WORDS = set(
    """
    в во на не и а но с со у по к ко из за от до о об что как это уже очень тут здесь там мне меня мой моя наш наша
    я мы вы он она оно они его ее их ли же бы то так вот есть был была было быть можно нужно надо пожалуйста
    подскажите скажите кабинет кабинете каб аудитория аудитории помещение помещении
    """.split()
)


# Что нельзя отправлять во внешнюю модель и хранить в журнале ИИ. Порядок важен: сначала длинные номера.
_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)")
_PHONE = re.compile(r"(?<!\d)(?:\+7|7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_SECRET = re.compile(r"(парол[ьяюе]|password|pass|логин)(\s*[:=]\s*)\S+", re.IGNORECASE)


def mask_personal(text: str) -> str:
    """Закрывает номера карт, телефоны, почту и пароли, если человек всё-таки написал их в обращении."""
    text = _CARD.sub("[номер скрыт]", text)
    text = _PHONE.sub("[телефон скрыт]", text)
    text = _EMAIL.sub("[почта скрыта]", text)
    return _SECRET.sub(r"\1\2[скрыто]", text)


def normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    text = re.sub(r"wi[\s-]?fi|вай[\s-]?фай", " wifi ", text)
    return re.sub(r"\s+", " ", text).strip()


def words(text: str) -> list[str]:
    return _WORD.findall(normalize(text))


def stems(text: str, size: int = 5) -> set[str]:
    return {w[:size] for w in words(text) if w not in STOP_WORDS and len(w) > 1}


def meaningful_words(text: str) -> list[str]:
    return [w for w in words(text) if w not in STOP_WORDS and len(w) > 2]


_ROOM = re.compile(r"(?:кабинет\w*|каб\.?|аудитори\w*|ауд\.?|комнат\w*|в|во)\s*№?\s*(\d{1,4}[а-яa-z]?)\b")


def extract_room(text: str) -> str | None:
    match = _ROOM.search(normalize(text))
    return match.group(1) if match else None


def short_title(text: str, limit: int = 60) -> str:
    clean = normalize(text)
    clean = re.sub(r"\b(?:в|во)\s+(?:кабинете|аудитории|каб\.?|ауд\.?)\s*№?\s*\d+\w*", "", clean)
    clean = re.sub(r"\b(?:кабинет|каб\.?|аудитория)\s*№?\s*\d+\w*", "", clean)
    clean = re.split(r"[.!?\n]", clean)[0]
    clean = re.sub(r"\s+", " ", clean).strip(" ,;:-")
    if len(clean) > limit:
        clean = clean[:limit].rsplit(" ", 1)[0]
    return clean[:1].upper() + clean[1:] if clean else ""
