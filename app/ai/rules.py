"""Классификатор на правилах. Работает без внешнего API и служит страховкой, если модель недоступна."""

import re

from . import safety
from .knowledge import Article, search
from .reply import AssistantReply
from .text import extract_room, meaningful_words, normalize, short_title

KB_MIN_SCORE = 0.6

CATEGORY_WORDS = {
    "equipment": (
        "проектор компьютер комп пк ноутбук ноут принтер мфу сканер монитор экран интерактивн доск колонк звук "
        "микрофон клавиатур мыш системн телевизор картридж камер веб-камер наушник hdmi кабель"
    ).split(),
    "furniture": (
        "стул парт стол шкаф двер ручк окн замок замк жалюз штор полк скамейк кресл стекл подоконник петл "
        "доводчик вешалк тумбочк"
    ).split(),
    "electricity": "свет ламп освещ розетк выключател электричеств светильник мигает удлинител автомат темно".split(),
    "network": "интернет wifi сеть сети роутер связь локальн вайфа".split(),
    "cleaning": "грязн мусор убра уборк пролил разлил пыль воня антисанитар мыло бумаг салфет насвинячил намусорил".split(),
    "plumbing": "кран туалет унитаз раковин протек протечк теч течет капает засор вода воды смыв канализац потоп кулер".split(),
    "climate": "холодно жарко душно отоплен батаре кондиционер проветр сквозняк вентиляц температур мерзн дует".split(),
}

# признаки того, что что-то сломалось или требует действий
FAULT_MARKERS = [
    m.strip()
    for m in """
    не работает, не работают, не работал, сломал, сломан, поломк, не включ, не печата, не горит, не горят,
    не выключ, разбит, разбил, треснул, трещин, не открыва, не закрыва, заклинил, отвалил, оторвал, шатается,
    шатает, не грузит, нет интернета, пропал, не показывает, нет звука, нет света, мигает, течет, протека, засор,
    грязно, мусор, холодно, жарко, душно, не ловит, глючит, завис, не реагирует, повреж, не видит, нет сети,
    барахлит, шумит, пищит, воняет, выбило, нет воды, капает, не смывает, не заряжа, не подключа, отклеил, порван,
    испорчен, темно, не хватает, закончил, закончилась, нет мыла, нет бумаги, дует, мерзнем, залил
    """.split(",")
]

QUESTION_START = re.compile(
    r"^(как|где|когда|куда|что|почему|зачем|можно ли|можно|кто|какой|какая|какие|каким|сколько|"
    r"подскажите|скажите|расскажите|объясните|нужно ли|чем|откуда|в каком|у кого)\b"
)

VAGUE = re.compile(r"\b(проблем\w*|помогите|помощь|беда|не знаю что делать|что-то не так|случилось|срочно)\b")

SAFE_CHECKS = {
    "equipment": [
        "Проверьте, что устройство включено в розетку и нажата кнопка питания",
        "Если это проектор или монитор, проверьте выбранный источник сигнала (HDMI или VGA)",
        "Не разбирайте устройство и не трогайте его, если оно повреждено",
    ],
    "furniture": [
        "Не пользуйтесь сломанной мебелью, чтобы никто не травмировался",
        "Если разбито стекло, не трогайте осколки руками",
    ],
    "electricity": [
        "Не трогайте розетки, выключатели и провода",
        "Проверьте, нет ли света в соседних кабинетах, и укажите это в заявке",
    ],
    "network": [
        "Переподключитесь к сети или перезагрузите своё устройство",
        "Проверьте, открываются ли другие сайты и работает ли интернет у соседей",
        "Не трогайте роутеры и сетевое оборудование",
    ],
    "cleaning": ["Укажите в заявке, где именно нужна уборка"],
    "plumbing": [
        "Если вода течёт рядом с розетками или техникой, не подходите и сразу сообщите сотруднику",
        "Не пытайтесь чинить сантехнику сами",
    ],
    "climate": ["Укажите в заявке, как давно это продолжается"],
    "other": [],
}

DEFAULT_TITLES = {
    "equipment": "Неисправность оборудования",
    "furniture": "Повреждение мебели или двери",
    "electricity": "Проблема с электрикой или освещением",
    "network": "Нет интернета",
    "cleaning": "Требуется уборка",
    "plumbing": "Проблема с сантехникой",
    "climate": "Проблема с температурой в помещении",
    "other": "Обращение в УПК",
}

FAULT_INTRO = {
    "cleaning": "Понял, тут нужна уборка.",
    "climate": "Понял, передам это сотрудникам, которые отвечают за климат в здании.",
    "network": "Похоже на проблему с сетью, тут нужен сотрудник.",
    "default": "Похоже на неисправность, тут нужен сотрудник.",
}

URGENT = re.compile(r"срочно|сейчас|пара|урок|занят|экзамен|зачет|контрольн|весь корпус|всем этаж")


# при равном числе совпадений выигрывает категория выше в списке:
# «в розетке у окна искрит» это электрика, а не окна
CATEGORY_PRIORITY = ("electricity", "plumbing", "equipment", "network", "climate", "furniture", "cleaning")


def detect_category(text: str) -> tuple[str | None, int]:
    norm = normalize(text)
    best, best_hits = None, 0
    for code in CATEGORY_PRIORITY:
        hits = sum(1 for s in CATEGORY_WORDS[code] if re.search(r"(?<![а-яa-z])" + re.escape(s), norm))
        if hits > best_hits:
            best, best_hits = code, hits
    return best, best_hits


def is_fault(text: str) -> bool:
    norm = normalize(text)
    return any(m in norm for m in FAULT_MARKERS)


def is_question(text: str) -> bool:
    norm = normalize(text)
    return norm.endswith("?") or bool(QUESTION_START.match(norm))


def suggest_priority(kind: str, category: str | None, text: str) -> str:
    norm = normalize(text)
    if kind == "danger":
        return "critical"
    if category == "plumbing" and re.search(r"затопил|потоп|хлещет|течет|протека", norm):
        return "high"
    if category == "electricity" and re.search(r"нет света|темно|не горит", norm):
        return "high"
    if category in ("equipment", "network", "electricity") and URGENT.search(norm):
        return "high"
    if category == "cleaning":
        return "low"
    return "normal"


def make_draft(text: str, category: str | None) -> tuple[str, str]:
    title = short_title(text)
    if len(title) < 12:
        title = DEFAULT_TITLES.get(category or "other", DEFAULT_TITLES["other"])
    description = re.sub(r"\s+", " ", text).strip()
    return title, description


def safety_reply(flag: str, text: str) -> AssistantReply:
    category, _ = detect_category(text)
    title, description = make_draft(text, category)
    if flag == safety.THREAT:
        # при угрозе жизни главное звонить 112 и уходить, а не заполнять заявку
        return AssistantReply(
            kind="danger",
            answer=safety.THREAT_ANSWER,
            tips=list(safety.THREAT_TIPS),
            category="other",
            confidence=1.0,
            priority="critical",
            engine="safety",
            guard="threat",
        )
    if flag == safety.DANGER:
        return AssistantReply(
            kind="danger",
            answer=safety.DANGER_ANSWER,
            tips=list(safety.DANGER_TIPS),
            category=category or "electricity",
            confidence=1.0,
            suggest_ticket=True,
            draft_title=title if len(title) >= 12 else "Опасная ситуация",
            draft_description=description,
            priority="critical",
            engine="safety",
            guard="danger",
            room_hint=extract_room(text),
        )
    if flag == safety.DIY:
        return AssistantReply(
            kind="danger",
            answer=safety.DIY_ANSWER,
            category=category or "electricity",
            confidence=1.0,
            suggest_ticket=True,
            draft_title=title,
            draft_description=description,
            priority="high",
            engine="safety",
            guard="diy",
            room_hint=extract_room(text),
        )
    return AssistantReply(
        kind="secret",
        answer=safety.SECRET_ANSWER,
        category=category or "network",
        confidence=1.0,
        engine="safety",
        guard="secret",
    )


def analyze(text: str, articles: list[Article], has_location: bool) -> AssistantReply:
    article, kb_score = search(articles, text)
    category, hits = detect_category(text)
    fault = is_fault(text)
    question = is_question(text)
    room = extract_room(text)

    if article and kb_score >= KB_MIN_SCORE and (question or not fault):
        reply = AssistantReply(
            kind="question",
            answer=article.answer,
            category=article.category or category,
            confidence=min(0.55 + kb_score * 0.4, 0.95),
            sources=[article.as_source()],
        )
        if fault:
            reply.suggest_ticket = True
            reply.draft_title, reply.draft_description = make_draft(text, reply.category)
        return reply

    if fault or (category and not question):
        category = category or "other"
        title, description = make_draft(text, category)
        tips = list(SAFE_CHECKS.get(category, []))
        sources = []
        if article and kb_score >= 0.45 and article.category == category:
            sources.append(article.as_source())
        confidence = 0.5 + 0.12 * min(hits, 2) + (0.15 if fault else 0)
        missing = [] if (has_location or room) else ["place"]
        answer = FAULT_INTRO.get(category, FAULT_INTRO["default"])
        answer += " Я подготовил черновик заявки, проверьте его и отправьте."
        if missing:
            answer += " Укажите, пожалуйста, где это случилось."
        return AssistantReply(
            kind="fault",
            answer=answer,
            category=category,
            confidence=round(min(confidence, 0.9), 2),
            tips=tips,
            sources=sources,
            suggest_ticket=True,
            draft_title=title,
            draft_description=description,
            missing=missing,
            priority=suggest_priority("fault", category, text),
            room_hint=room,
        )

    if question:
        return AssistantReply(
            kind="unknown",
            answer=(
                "Проверенной информации по этому вопросу у меня нет, поэтому не буду гадать. "
                "Обратитесь к ответственному сотруднику УПК или оставьте обращение, и вам ответит человек."
            ),
            category=category,
            confidence=0.3,
        )

    words = meaningful_words(text)
    if len(words) < 4 or VAGUE.search(normalize(text)):
        return AssistantReply(
            kind="unclear",
            answer="Расскажите чуть подробнее, чтобы я понял, чем помочь.",
            clarify_question="Что именно случилось и где? Например: «В кабинете 214 не работает проектор».",
            confidence=0.4,
            missing=["problem"] + ([] if has_location else ["place"]),
        )

    title, description = make_draft(text, "other")
    return AssistantReply(
        kind="fault",
        answer=(
            "Я не уверен, к какой категории это относится, поэтому передам решение сотруднику. "
            "Проверьте черновик заявки и отправьте его."
        ),
        category="other",
        confidence=0.35,
        suggest_ticket=True,
        draft_title=title,
        draft_description=description,
        missing=[] if has_location else ["place"],
        room_hint=room,
    )
