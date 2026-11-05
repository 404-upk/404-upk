"""Классификатор на правилах. Работает без внешнего API и служит страховкой, если модель недоступна."""

import re

from . import safety
from .knowledge import Article, search
from .reply import AssistantReply
from .text import extract_room, meaningful_words, normalize, short_title, understand

KB_MIN_SCORE = 0.6

CATEGORY_WORDS = {
    "equipment": (
        "проектор компьютер комп пк ноутбук ноут принтер мфу сканер монитор экран интерактивн доск колонк звук "
        "микрофон клавиатур мыш системн телевизор картридж камер веб-камер наушник hdmi кабель маркер фломастер"
    ).split(),
    "furniture": (
        "стул парт стол шкаф двер ручк окн замок замк жалюз штор полк скамейк кресл стекл подоконник петл "
        "доводчик вешалк тумбочк"
    ).split(),
    "electricity": "свет ламп освещ розетк выключател электричеств светильник удлинител автомат темно".split(),
    "network": "интернет wifi сеть сети роутер связь локальн вайфа".split(),
    "cleaning": "грязн мусор убра уборк пролил разлил пыль воня антисанитар мыло бумаг салфет насвинячил намусорил".split(),
    "plumbing": "кран луж туалет унитаз раковин протек протечк теч течет капает засор вода воды смыв канализац потоп кулер".split(),
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
    испорчен, темно, не хватает, закончил, закончилась, нет мыла, нет бумаги, дует, мерзнем, залил,
    не пашет, не фурычит, сдох, вырубил, не пишет, не тянет, тормоз, заел, заклин, забит, забил, перегор,
    не греет, оборва, отлетел, хрипит, кончил, переполн, разлил, пролил, медленн, зажевал, замял
    """.split(",")
]

QUESTION_START = re.compile(
    r"^(во сколько|в какое время|как|где|когда|куда|что|почему|зачем|можно ли|можно|кто|кому|какой|какая|какое|какую|каком|какие|каким|сколько|"
    r"подскажите|скажите|расскажите|объясните|нужно ли|чем|откуда|в каком|у кого)\b"
)

VAGUE = re.compile(r"\b(проблем\w*|помогите|помощь|беда|не знаю что делать|что-то не так|случилось|срочно)\b")

# просьбы не по теме: заявка тут не поможет, а модель тратить незачем
OFF_TOPIC = re.compile(
    r"^(реши|решите|посчитай|вычисли|напиши|сочини|придумай|переведи|покажи|расскажи (анекдот|шутку|сказку|стих)|"
    r"сделай (домашк|реферат|доклад|курсов))\b|\d\s*[+*/=]\s*\d"
)
OFF_TOPIC_ANSWER = (
    "С этим я не помогу: я отвечаю только на вопросы о помещениях, оборудовании и заявках колледжа. "
    "Если что-то сломалось или не работает, опишите проблему, и я подготовлю заявку."
)
UNKNOWN_ANSWER = (
    "Проверенной информации по этому вопросу у меня нет, поэтому не буду гадать. "
    "Обратитесь к ответственному сотруднику УПК или оставьте обращение, и вам ответит человек."
)
_NO_WORD = re.compile(r"\bнету\b")
# мыло и бумага заканчиваются в туалете, но это уборка, а не сантехника
_SUPPLIES = re.compile(
    r"\b(нет|нету|закончил\w*|кончил\w*)\b.{0,30}(мыл|бумаг|салфет|полотенц)|"
    r"(мыл|бумаг|салфет|полотенц)\w*.{0,20}\b(закончил\w*|кончил\w*|нет|нету)\b"
)
_PRINTING = re.compile(r"принтер|мфу|сканер|копир")
# грязь важнее места, где она находится: «грязные столы» это уборка, а не мебель
_DIRTY = re.compile(r"грязн|мусор|воня")
_WATER = re.compile(r"вод[аеуы]|кран|раковин|унитаз|канализац")

_GREETING = re.compile(
    r"^(привет\w*|здравствуй\w*|добрый (день|вечер)|доброе утро|салам\w*|ассалам\w*|hello|hi)[!.,\s]*$"
)
_THANKS = re.compile(r"^(спасибо|благодарю|спс)( большое| огромное)?[!.,\s]*$")
_ACK = re.compile(r"^(ок|окей|ok|хорошо|понял|поняла|понятно|ясно|ладно)[!.,\s]*$")

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

# советы под конкретное устройство проверены людьми, ремонта среди них нет
DEVICE_TIPS = [
    (
        re.compile(r"принтер|мфу|картридж|сканер|копир"),
        [
            "Проверьте, есть ли бумага в лотке и не мигает ли на принтере индикатор ошибки",
            "Если бумагу зажевало, не тяните её силой",
            "Не открывайте корпус, с картриджем поможет сотрудник",
        ],
    ),
    (
        re.compile(r"проектор"),
        [
            "Проверьте, что проектор включён и на пульте выбран нужный вход (HDMI или VGA)",
            "Проверьте, плотно ли вставлен кабель в ноутбук и в проектор",
            "Не открывайте корпус: лампа внутри сильно нагревается",
        ],
    ),
    (
        re.compile(r"интерактивн|доск"),
        [
            "Проверьте, что доска и компьютер рядом с ней включены",
            "Если доска не реагирует на касания, проверьте USB-кабель от неё к компьютеру",
        ],
    ),
    (
        re.compile(r"монитор|экран|телевизор"),
        [
            "Проверьте, что устройство включено и кабель плотно вставлен с обеих сторон",
            "Не открывайте корпус и не трогайте устройство, если оно повреждено",
        ],
    ),
    (
        re.compile(r"клавиатур|мыш|наушник|колонк|звук|микрофон|камер"),
        [
            "Проверьте, плотно ли вставлен кабель и включена ли громкость",
            "Попробуйте другой разъём USB, если он свободен",
        ],
    ),
    (
        re.compile(r"компьютер|\bкомп|\bпк\b|ноутбук|\bноут|системн"),
        [
            "Проверьте, что кабель питания вставлен и нажата кнопка включения",
            "Если компьютер завис, подождите минуту и перезагрузите его кнопкой",
            "Не открывайте корпус",
        ],
    ),
    (re.compile(r"маркер|фломастер"), ["Укажите в заявке, сколько и каких расходников нужно"]),
]

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
    norm = understand(text)
    if _SUPPLIES.search(norm) and not _PRINTING.search(norm):
        return "cleaning", 2
    if _DIRTY.search(norm) and not _WATER.search(norm):
        return "cleaning", 2
    best, best_hits = None, 0
    for code in CATEGORY_PRIORITY:
        hits = sum(1 for s in CATEGORY_WORDS[code] if re.search(r"(?<![а-яa-z])" + re.escape(s), norm))
        if hits > best_hits:
            best, best_hits = code, hits
    return best, best_hits


def is_fault(text: str) -> bool:
    norm = understand(text)
    return any(m in norm for m in FAULT_MARKERS) or bool(_NO_WORD.search(norm))


def is_vague(text: str) -> bool:
    """В сообщении нет ничего конкретного: «у меня проблема», «помогите»."""
    return bool(VAGUE.search(normalize(text))) and not detect_category(text)[0] and not is_fault(text)


def safe_tips(category: str | None, text: str) -> list[str]:
    if category == "equipment":
        norm = understand(text)
        for pattern, tips in DEVICE_TIPS:
            if pattern.search(norm):
                return list(tips)
    return list(SAFE_CHECKS.get(category or "other", []))


def fault_answer(category: str | None, missing: list[str]) -> str:
    answer = FAULT_INTRO.get(category or "other", FAULT_INTRO["default"])
    answer += " Я подготовил черновик заявки, проверьте его и отправьте."
    if "place" in missing:
        answer += " Укажите, пожалуйста, где это случилось."
    return answer


def polish_fault(reply: AssistantReply, text: str) -> None:
    """Модель хорошо распознаёт проблему, но слова для человека и советы лучше брать проверенные."""
    reply.answer = fault_answer(reply.category, reply.missing)
    vetted = safe_tips(reply.category, text)
    if vetted:
        reply.tips = vetted


def smalltalk(text: str) -> AssistantReply | None:
    norm = normalize(text)
    if _GREETING.match(norm):
        answer = "Здравствуйте! Опишите, что случилось и где, или задайте вопрос."
    elif _THANKS.match(norm):
        answer = "Пожалуйста! Если появится другая проблема, просто напишите."
    elif _ACK.match(norm):
        answer = "Хорошо. Если что-то сломается или появится вопрос, просто напишите."
    else:
        return None
    return AssistantReply(kind="unclear", answer=answer, confidence=1.0, engine="rules", guard="smalltalk")


def is_question(text: str) -> bool:
    norm = normalize(text)
    return norm.endswith("?") or bool(QUESTION_START.match(norm))


def suggest_priority(kind: str, category: str | None, text: str) -> str:
    norm = understand(text)
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


def is_relevant(text: str) -> bool:
    """Относится ли прошлое сообщение к проблеме: посторонние фразы не должны попасть в заявку."""
    flag = safety.detect(text)
    # опасность и попытки обойти правила остаются в силе и в следующих сообщениях
    if flag and flag != safety.UNWELL:
        return True
    return bool(detect_category(text)[0] or is_fault(text) or extract_room(text))


def safety_reply(flag: str, text: str) -> AssistantReply:
    category, _ = detect_category(text)
    title, description = make_draft(text, category)
    if flag == safety.INJECTION:
        return AssistantReply(
            kind="unclear",
            answer=safety.INJECTION_ANSWER,
            clarify_question="Что именно случилось и где? Например: «В кабинете 214 не работает проектор».",
            confidence=1.0,
            engine="safety",
            guard="injection",
        )
    if flag == safety.UNWELL:
        return AssistantReply(
            kind="danger",
            answer=safety.UNWELL_ANSWER,
            category="other",
            confidence=1.0,
            engine="safety",
            guard="unwell",
        )
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


def analyze(text: str, articles: list[Article], has_location: bool, answering: bool = False) -> AssistantReply:
    """answering: человек отвечает на наш вопрос «что случилось», поэтому «проектор» значит поломку, а не запрос статьи."""
    article, kb_score = search(articles, understand(text))
    category, hits = detect_category(text)
    fault = is_fault(text)
    question = is_question(text)
    room = extract_room(text)

    if article and kb_score >= KB_MIN_SCORE and (question or not (fault or answering)):
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
        tips = safe_tips(category, text)
        sources = []
        if article and kb_score >= 0.45 and article.category == category:
            sources.append(article.as_source())
        confidence = 0.5 + 0.12 * min(hits, 2) + (0.15 if fault else 0)
        missing = [] if (has_location or room) else ["place"]
        return AssistantReply(
            kind="fault",
            answer=fault_answer(category, missing),
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

    if OFF_TOPIC.search(normalize(text)):
        return AssistantReply(kind="unknown", answer=OFF_TOPIC_ANSWER, confidence=0.9, guard="off_topic")

    if question and not VAGUE.search(normalize(text)):
        return AssistantReply(kind="unknown", answer=UNKNOWN_ANSWER, category=category, confidence=0.3)

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
