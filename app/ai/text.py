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
_PASSPORT = re.compile(r"(?<!\d)\d{2}\s?\d{2}\s?\d{6}(?!\d)")
_SHORT_PHONE = re.compile(r"(?<![\d-])\d{2,3}-\d{2}-\d{2}(?![\d-])")
_FULL_NAME = re.compile(r"\b[А-ЯЁ][а-яё]+\s+(?:[А-ЯЁ][а-яё]+(?:ович|евич|ична|овна|евна)\b|[А-ЯЁ]\.\s?[А-ЯЁ]\.)")
_SECRET = re.compile(
    r"(парол[ьяюе]|password|pass|логин)(\s*[:=]\s*|\s+(?:это\s+)?)(?!(?:от|для|не|на|и|у|в|к|с)\b)\S+", re.IGNORECASE
)


def mask_personal(text: str) -> str:
    """Закрывает номера карт, телефоны, почту и пароли, если человек всё-таки написал их в обращении."""
    text = _CARD.sub("[номер скрыт]", text)
    text = _PHONE.sub("[телефон скрыт]", text)
    text = _EMAIL.sub("[почта скрыта]", text)
    text = _PASSPORT.sub("[номер скрыт]", text)
    text = _SHORT_PHONE.sub("[телефон скрыт]", text)
    text = _FULL_NAME.sub("[имя скрыто]", text)
    return _SECRET.sub(r"\1\2[скрыто]", text)


def normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    text = re.sub(r"wi[\s-]?fi|вай[\s-]?фа\w*|вифи\w*", " wifi ", text)
    return re.sub(r"\s+", " ", text).strip()


def words(text: str) -> list[str]:
    return _WORD.findall(normalize(text))


def stems(text: str, size: int = 5) -> set[str]:
    return {w[:size] for w in words(text) if w not in STOP_WORDS and len(w) > 1}


def meaningful_words(text: str) -> list[str]:
    return [w for w in words(text) if w not in STOP_WORDS and len(w) > 2]


_ROOM_NAMED = re.compile(r"(?:кабинет\w*|каб\.?|аудитори\w*|ауд\.?|комнат\w*)\s*№?\s*(\d{1,4}[а-яa-z]?)\b")
# просто «в 214» считаем кабинетом только при трёхзначном номере: «в 2 часа» и «в 15 минут» это время
_ROOM_SHORT = re.compile(r"\bво?\s*№?\s*(\d{3}[а-яa-z]?)\b(?!\s*(?:час|мин|сек|дн|ден|год|лет|руб))")


def extract_room(text: str) -> str | None:
    clean = normalize(text)
    match = _ROOM_NAMED.search(clean) or _ROOM_SHORT.search(clean)
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


# разговорные слова, которых нет в правилах
_SLANG = {
    "клава": "клавиатура",
    "клаву": "клавиатура",
    "клавы": "клавиатура",
    "кондей": "кондиционер",
    "кондея": "кондиционер",
    "кондер": "кондиционер",
    "инет": "интернет",
    "инета": "интернет",
    "инете": "интернет",
    "инэт": "интернет",
    "толчок": "туалет",
    "толчка": "туалет",
    "толчке": "туалет",
    "сортир": "туалет",
    "сортире": "туалет",
    "телик": "телевизор",
    "телика": "телевизор",
    "течот": "течет",
    "врубается": "включается",
}
# слова, в которых чаще всего ошибаются; короче шести букв не берём: «жалко» не должно стать «жарко»
_KNOWN_WORDS = frozenset(
    """
    проектор принтер компьютер ноутбук монитор клавиатура колонки микрофон телевизор интернет роутер розетка
    проводка провода выключатель светильник лампочка батарея кондиционер отопление вентиляция туалет унитаз
    раковина канализация грязно сломался сломалась сломалось сломан сломано работает работают включается
    выключается печатает показывает подключается закрывается открывается холодно холодная холодный протекает
    шатается заклинило
    """.split()
)


def _distance_within(a: str, b: str, limit: int) -> bool:
    """Расстояние Дамерау-Левенштейна не больше limit: перепутанные соседние буквы считаются одной ошибкой."""
    if abs(len(a) - len(b)) > limit:
        return False
    before, row = None, list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            cost = min(row[j] + 1, current[j - 1] + 1, row[j - 1] + (ca != cb))
            if before is not None and i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cost = min(cost, before[j - 2] + 1)
            current.append(cost)
        before, row = row, current
    return row[-1] <= limit


def _fix_word(word: str) -> str:
    if word in _SLANG:
        return _SLANG[word]
    if len(word) < 6 or word in _KNOWN_WORDS:
        return word
    for known in _KNOWN_WORDS:
        # две ошибки допускаем только в длинном слове с верной первой буквой
        limit = 2 if len(word) >= 8 and word[0] == known[0] else 1
        if _distance_within(word, known, limit):
            return known
    return word


def understand(text: str) -> str:
    """Текст для распознавания: исправлены частые опечатки и жаргон. В заявку идёт исходный текст человека."""
    return re.sub(r"[а-я]+", lambda m: _fix_word(m.group(0)), normalize(text))
