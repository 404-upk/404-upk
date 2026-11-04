"""Начальные данные: категории, помещения, база знаний и демо-аккаунты.

Запуск вручную:  python -m app.seed --reset        (пересоздать базу)
                 python -m app.seed --reset --clean (без демо-заявок)
"""

import argparse
import random
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal, init_db, reset_db
from .models import (
    ROLE_ADMIN,
    ROLE_EXECUTOR,
    ROLE_STAFF,
    AiLog,
    Category,
    Comment,
    KnowledgeArticle,
    Location,
    Ticket,
    TicketHistory,
    Tracker,
    User,
    utcnow,
)
from .security import hash_password, hash_token, new_tracking_code

CATEGORIES = [
    (
        "equipment",
        "Оборудование и техника",
        "Проекторы, компьютеры, принтеры, интерактивные доски",
        "equipment",
        "normal",
        "it",
    ),
    ("furniture", "Мебель, двери и окна", "Столы, стулья, шкафы, ручки, замки, окна", "furniture", "normal", "service"),
    ("electricity", "Электрика и освещение", "Свет, розетки, выключатели", "electricity", "high", "electric"),
    ("network", "Интернет и связь", "Wi-Fi и проводная сеть", "network", "normal", "it"),
    (
        "cleaning",
        "Уборка и санитария",
        "Мусор, грязь, пролитая жидкость, расходники в туалетах",
        "cleaning",
        "low",
        "cleaning",
    ),
    ("plumbing", "Сантехника и вода", "Краны, туалеты, протечки, кулеры", "plumbing", "normal", "service"),
    ("climate", "Отопление и климат", "Холодно, жарко, душно, кондиционеры", "climate", "normal", "service"),
    ("other", "Другое", "Всё, что не подходит под остальные категории", "other", "normal", None),
]

USERS = [
    ("admin", "Администратор системы", "Администратор", ROLE_ADMIN),
    ("upk", "Елена Белова", "Специалист УПК", ROLE_STAFF),
    ("electric", "Олег Смирнов", "Электрик", ROLE_EXECUTOR),
    ("it", "Анна Кузнецова", "Системный администратор", ROLE_EXECUTOR),
    ("service", "Руслан Магомедов", "Хозяйственная служба", ROLE_EXECUTOR),
    ("cleaning", "Мария Орлова", "Клининговая служба", ROLE_EXECUTOR),
]

# (корпус, этаж, кабинет, название зоны, тип, qr-ключ)
LOCATIONS = [
    ("Корпус 1", 1, "101", None, "room", "r101kx7m"),
    ("Корпус 1", 1, "102", None, "room", "r102vq3p"),
    ("Корпус 1", 1, "103", None, "room", "r103hd8s"),
    ("Корпус 1", 1, None, "Главный холл", "common", "hall9wze"),
    ("Корпус 1", 1, None, "Столовая", "common", "food4ntg"),
    ("Корпус 1", 2, "201", None, "room", "r201mz5c"),
    ("Корпус 1", 2, "202", None, "room", "r202pw2k"),
    ("Корпус 1", 2, "205", "Компьютерный класс", "lab", "lab205jr"),
    ("Корпус 1", 2, "210", None, "room", "r210ty6b"),
    ("Корпус 1", 2, "214", None, "room", "r214qa9f"),
    ("Корпус 1", 2, None, "Туалет у лестницы", "common", "wc2s8hyn"),
    ("Корпус 1", 3, "301", None, "room", "r301ub4e"),
    ("Корпус 1", 3, "305", None, "room", "r305gc7v"),
    ("Корпус 1", 3, "310", "Лаборатория электротехники", "lab", "lab310kp"),
    ("Корпус 1", 3, "312", None, "room", "r312nx3w"),
    ("Корпус 1", 3, None, "Актовый зал", "common", "aula6rmd"),
    ("Корпус 2", 1, "104", None, "room", "b104fs2t"),
    ("Корпус 2", 1, None, "Библиотека", "common", "libr5xcj"),
    ("Корпус 2", 1, None, "Спортзал", "common", "gym7pzha"),
    ("Корпус 2", 2, "220", "Лаборатория химии", "lab", "lab220wq"),
    ("Корпус 2", 2, "221", None, "room", "b221ek8n"),
    ("Корпус 2", 2, "224", None, "room", "b224rv4y"),
]

ARTICLES = [
    (
        "Как подключить ноутбук к проектору",
        "1. Включите проектор кнопкой на корпусе или пультом и подождите около минуты, пока он прогреется.\n"
        "2. Подключите ноутбук кабелем HDMI (или VGA, если на ноутбуке нет HDMI).\n"
        "3. На пульте проектора выберите источник сигнала кнопкой Source или Input.\n"
        "4. На ноутбуке нажмите Win+P и выберите «Повторяющийся» или «Расширить».\n"
        "Если изображения нет, проверьте, что кабель плотно вставлен с обеих сторон. "
        "Если не помогло, оформите заявку, и проектор проверит сотрудник.",
        "equipment",
        "подключить ноутбук к проектору, подключить проектор, вывести изображение на проектор, проектор hdmi, "
        "показать презентацию на проекторе, ноутбук к проектору, вывести экран",
    ),
    (
        "Принтер не печатает: что можно проверить",
        "Безопасно можно проверить: включён ли принтер и нет ли на его экране ошибки, есть ли бумага в лотке, "
        "выбран ли на компьютере нужный принтер и нет ли зависших документов в очереди печати (их можно удалить). "
        "Не открывайте корпус и не вытаскивайте застрявшую бумагу с усилием. Если не помогло, оформите заявку.",
        "equipment",
        "принтер не печатает, не печатает, очередь печати, застряла бумага, мфу не печатает, принтер",
    ),
    (
        "Как сообщить о неисправности",
        "Отсканируйте QR-код в помещении или откройте сайт помощника и опишите, что случилось. Если вы пришли "
        "по QR-коду, кабинет подставится сам. При желании приложите фото. После отправки вы получите номер "
        "заявки и код отслеживания.",
        None,
        "как сообщить о неисправности, как оставить заявку, как подать заявку, куда сообщить, куда писать, "
        "как создать заявку, сообщить о поломке, куда обращаться",
    ),
    (
        "Как выбрать категорию обращения",
        "Оборудование и техника: проекторы, компьютеры, принтеры, интерактивные доски. Мебель, двери и окна: "
        "столы, стулья, шкафы, ручки, замки. Электрика и освещение: свет, розетки, выключатели. Интернет и связь: "
        "Wi-Fi и проводная сеть. Уборка: мусор, грязь, пролитая жидкость. Сантехника: краны, туалеты, протечки. "
        "Отопление и климат: холодно, жарко, душно. Если сомневаетесь, выберите «Другое», сотрудник поправит "
        "категорию сам.",
        None,
        "какую категорию выбрать, выбрать категорию, категория обращения, какие есть категории",
    ),
    (
        "Что делать, если повреждено имущество",
        "Не пользуйтесь сломанной мебелью или техникой и предупредите тех, кто рядом. Если разбито стекло, "
        "не трогайте осколки руками. Сфотографируйте повреждение, если это безопасно, и оформите заявку "
        "с указанием места.",
        "furniture",
        "повреждено имущество, что делать если сломал, порча имущества, случайно сломал, разбил стекло",
    ),
    (
        "Как проверить статус заявки",
        "После отправки заявки вы получаете ссылку и код отслеживания из 16 символов. Откройте ссылку или "
        "введите код на странице «Проверить статус». Там видно текущий статус, комментарии сотрудников "
        "и историю изменений. Там же можно включить уведомления в Telegram, если эта функция подключена.",
        None,
        "статус заявки, проверить статус, где посмотреть статус, отследить заявку, код отслеживания, "
        "что с моей заявкой, где моя заявка, как узнать статус",
    ),
    (
        "Сроки выполнения заявок",
        "Точный срок помощник назвать не может: он зависит от сложности работ и загрузки сотрудников. "
        "Следите за статусом заявки по коду отслеживания. Если ситуация срочная, напишите об этом "
        "в описании заявки или обратитесь к сотруднику УПК лично.",
        None,
        "когда починят, когда сделают, когда исправят, сроки ремонта, сколько ждать, как долго ждать, "
        "срок выполнения, когда придут, когда отремонтируют",
    ),
    (
        "Нет интернета или Wi-Fi: что проверить",
        "Отключитесь от сети и подключитесь заново, перезагрузите своё устройство и проверьте, открываются ли "
        "другие сайты. Спросите, работает ли интернет у соседей: так сотруднику будет проще найти причину. "
        "Роутеры и сетевое оборудование трогать нельзя. Если интернета нет, оформите заявку.",
        "network",
        "нет интернета, не работает wifi, не подключается к wifi, пропал интернет, медленный интернет, "
        "плохо ловит wifi",
    ),
    (
        "Компьютер не включается: безопасные проверки",
        "Проверьте, что кабель питания вставлен в компьютер и в розетку, а монитор включён своей кнопкой. "
        "Нажмите кнопку питания на системном блоке один раз. Не открывайте корпус и не переставляйте провода "
        "внутри. Если компьютер так и не включился, оформите заявку.",
        "equipment",
        "компьютер не включается, пк не включается, монитор не включается, черный экран, нет изображения на мониторе",
    ),
    (
        "Что делать при запахе гари, дыме или искрах",
        "Не трогайте оборудование и розетки, отойдите сами и попросите отойти остальных. Сразу сообщите "
        "ответственному сотруднику или дежурному администратору. Если видите огонь, сильный дым или кому-то "
        "плохо, звоните 112 и действуйте по правилам эвакуации колледжа.",
        "electricity",
        "запах гари, дым, искры, пожарная безопасность, что делать при пожаре",
    ),
    (
        "Как получить доступ к Wi-Fi колледжа",
        "Данные для подключения к сети колледжа помощник не сообщает, их выдаёт ответственный сотрудник. "
        "Оставьте обращение в категории «Интернет и связь» или обратитесь к сотруднику УПК лично.",
        "network",
        "доступ к wifi, подключиться к wifi колледжа, как получить доступ к интернету, сеть колледжа",
    ),
    (
        "Интерактивная доска не реагирует на касания",
        "Проверьте, что доска включена и подключена к компьютеру кабелем USB, а на компьютере открыта программа "
        "доски. Иногда помогает перезапуск этой программы. Не протирайте экран жидкостями и не нажимайте на него "
        "острыми предметами. Если не помогло, оформите заявку.",
        "equipment",
        "интерактивная доска, доска не реагирует, сенсор не работает, интерактивная доска не работает",
    ),
]

# (дней назад, заголовок, описание, категория, qr-ключ места, путь статусов, исполнитель,
#  часов до закрытия, оценка, сколько человек сообщили, приоритет)
DEMO_TICKETS = [
    (
        11,
        "Не работает розетка у окна",
        "Розетка у окна не работает, ноутбук не заряжается.",
        "electricity",
        "r101kx7m",
        ["review", "assigned", "in_progress", "resolved"],
        "electric",
        20,
        5,
        1,
        "normal",
    ),
    (
        10,
        "Сломан стул у третьей парты",
        "У стула отломилась спинка, сидеть нельзя.",
        "furniture",
        "r305gc7v",
        ["assigned", "in_progress", "resolved"],
        "service",
        30,
        4,
        1,
        "normal",
    ),
    (
        9,
        "Нет интернета в компьютерном классе",
        "На всех компьютерах нет интернета, пара сорвалась.",
        "network",
        "lab205jr",
        ["assigned", "in_progress", "resolved"],
        "it",
        5,
        5,
        3,
        "high",
    ),
    (
        8,
        "Течёт кран в туалете",
        "Кран не закрывается до конца, постоянно течёт вода.",
        "plumbing",
        "wc2s8hyn",
        ["review", "assigned", "in_progress", "resolved"],
        "service",
        26,
        None,
        2,
        "normal",
    ),
    (
        7,
        "Не печатает принтер",
        "Принтер в 210 пишет ошибку и не печатает.",
        "equipment",
        "r210ty6b",
        ["assigned", "in_progress", "resolved"],
        "it",
        3,
        4,
        1,
        "normal",
    ),
    (
        6,
        "Холодно в аудитории",
        "Батареи еле тёплые, в аудитории очень холодно.",
        "climate",
        "r312nx3w",
        ["review", "assigned", "in_progress", "resolved"],
        "service",
        44,
        3,
        2,
        "normal",
    ),
    (
        6,
        "Мусор на лестнице",
        "На лестнице между 1 и 2 этажом много мусора.",
        "cleaning",
        "hall9wze",
        ["review", "rejected"],
        None,
        4,
        None,
        1,
        "low",
    ),
    (
        5,
        "Мигает свет над доской",
        "Лампа над доской постоянно мигает, болят глаза.",
        "electricity",
        "r305gc7v",
        ["assigned", "in_progress"],
        "electric",
        None,
        None,
        1,
        "normal",
    ),
    (
        4,
        "Не закрывается дверь",
        "Дверь в лабораторию не закрывается на замок.",
        "furniture",
        "lab220wq",
        ["assigned"],
        "service",
        None,
        None,
        1,
        "normal",
    ),
    (
        3,
        "Пролили сок в столовой",
        "У окна разлили сок, пол липкий.",
        "cleaning",
        "food4ntg",
        ["assigned", "in_progress", "resolved"],
        "cleaning",
        1,
        5,
        1,
        "low",
    ),
    (
        2,
        "Опять пропал интернет",
        "Снова нет интернета на компьютерах у окна.",
        "network",
        "lab205jr",
        ["assigned", "in_progress"],
        "it",
        None,
        None,
        2,
        "high",
    ),
    (
        1,
        "Не работает интерактивная доска",
        "Доска включается, но не реагирует на касания.",
        "equipment",
        "r301ub4e",
        ["review"],
        None,
        None,
        None,
        1,
        "normal",
    ),
    (
        0.8,
        "Нужна уборка после мероприятия",
        "После концерта в актовом зале остался мусор.",
        "cleaning",
        "aula6rmd",
        [],
        None,
        None,
        None,
        1,
        "low",
    ),
    (
        0.25,
        "Не горит свет в коридоре",
        "В коридоре темно, свет не включается.",
        "electricity",
        "hall9wze",
        ["need_info"],
        None,
        None,
        None,
        1,
        "high",
    ),
    (
        0.1,
        "Шатается парта",
        "Парта у двери сильно шатается.",
        "furniture",
        "r102vq3p",
        [],
        None,
        None,
        None,
        1,
        "normal",
    ),
]

CLOSING_NOTES = {
    "resolved": [
        "Неисправность устранена, всё работает.",
        "Заменили деталь, проверили на месте.",
        "Работы выполнены, спасибо за обращение.",
    ],
    "rejected": ["Лестница убирается по графику, уборка уже была выполнена до разбора заявки."],
    "need_info": ["Уточните, пожалуйста, в каком крыле коридора не горит свет?"],
}

DEMO_AI_QUESTIONS = [
    ("Как подключить ноутбук к проектору?", "question", "equipment"),
    ("Где посмотреть статус заявки?", "question", None),
    ("Принтер не печатает, что делать?", "question", "equipment"),
    ("Когда починят проектор?", "question", None),
    ("Как получить доступ к Wi-Fi?", "question", "network"),
    ("Какой пароль от Wi-Fi сотрудников?", "secret", "network"),
    ("В розетке искрит", "danger", "electricity"),
    ("Сколько стоит обучение?", "unknown", None),
    ("У меня проблема", "unclear", None),
    ("Компьютер не включается", "question", "equipment"),
    ("Интерактивная доска не реагирует", "question", "equipment"),
    ("Как выбрать категорию?", "question", None),
]


def seed_reference(db: Session) -> None:
    if db.scalar(select(func.count(User.id))):
        return

    users = {}
    passwords = {
        ROLE_ADMIN: settings.demo_admin_password,
        ROLE_STAFF: settings.demo_staff_password,
        ROLE_EXECUTOR: settings.demo_executor_password,
    }
    for login, name, position, role in USERS:
        user = User(login=login, name=name, position=position, role=role, password_hash=hash_password(passwords[role]))
        db.add(user)
        users[login] = user
    db.flush()

    categories = {}
    for sort, (code, name, desc, icon, priority, assignee) in enumerate(CATEGORIES):
        category = Category(
            code=code,
            name=name,
            description=desc,
            icon=icon,
            default_priority=priority,
            default_assignee_id=users[assignee].id if assignee else None,
            sort=sort,
        )
        db.add(category)
        categories[code] = category
    db.flush()

    for building, floor, room, zone, kind, key in LOCATIONS:
        db.add(Location(building=building, floor=floor, room=room, zone_name=zone, kind=kind, qr_key=key))

    for question, answer, category, keywords in ARTICLES:
        db.add(
            KnowledgeArticle(
                question=question,
                answer=answer,
                category_id=categories[category].id if category else None,
                keywords=keywords,
                source="База знаний УПК (демо)",
            )
        )
    db.commit()


def seed_demo_tickets(db: Session) -> None:
    if db.scalar(select(func.count(Ticket.id))):
        return
    rnd = random.Random(42)
    now = utcnow()
    users = {u.login: u for u in db.scalars(select(User)).all()}
    categories = {c.code: c for c in db.scalars(select(Category)).all()}
    locations = {loc.qr_key: loc for loc in db.scalars(select(Location)).all()}
    staff = users["upk"]

    for number, row in enumerate(DEMO_TICKETS, start=1):
        days, title, description, cat, loc, path, assignee, close_hours, rating, reports, priority = row
        created = now - timedelta(days=days, minutes=rnd.randint(0, 300))
        ticket = Ticket(
            number=number,
            title=title,
            description=description,
            category=categories[cat],
            location=locations[loc],
            status="new",
            priority=priority,
            source=rnd.choice(["qr", "qr", "manual"]),
            ai_kind="fault",
            ai_engine="fallback",
            ai_confidence=round(rnd.uniform(0.62, 0.9), 2),
            reports_count=reports,
            created_at=created,
            updated_at=created,
        )
        db.add(ticket)
        db.add(Tracker(ticket=ticket, token_hash=hash_token(new_tracking_code()), created_at=created))
        db.add(
            TicketHistory(ticket=ticket, action="created", new_value="new", actor_label="Заявитель", created_at=created)
        )
        db.add(
            AiLog(
                created_at=created - timedelta(minutes=1),
                message=description,
                location_id=locations[loc].id,
                kind="fault",
                category_code=cat,
                confidence=ticket.ai_confidence,
                engine="fallback",
                answer="Похоже на неисправность, тут нужен сотрудник.",
                latency_ms=rnd.randint(8, 40),
                ticket=ticket,
            )
        )
        for extra in range(reports - 1):
            db.add(
                TicketHistory(
                    ticket=ticket,
                    action="joined",
                    new_value=str(extra + 2),
                    actor_label="Заявитель",
                    created_at=created + timedelta(minutes=20 * (extra + 1)),
                )
            )

        moment = created
        steps = len(path)
        total_hours = close_hours or max(days * 24 * 0.6, 0.5)
        old = "new"
        for i, status in enumerate(path):
            moment = created + timedelta(hours=total_hours * (i + 1) / steps)
            if status == "assigned" and assignee:
                ticket.assignee = users[assignee]
                db.add(
                    TicketHistory(
                        ticket=ticket,
                        actor_id=staff.id,
                        actor_label=staff.name,
                        action="assignee",
                        new_value=users[assignee].name,
                        is_public=False,
                        created_at=moment,
                    )
                )
            note = rnd.choice(CLOSING_NOTES[status]) if status in CLOSING_NOTES else None
            actor = users[assignee] if status == "in_progress" and assignee else staff
            db.add(
                TicketHistory(
                    ticket=ticket,
                    actor_id=actor.id,
                    actor_label=actor.name,
                    action="status",
                    old_value=old,
                    new_value=status,
                    note=note,
                    created_at=moment,
                )
            )
            if status == "in_progress":
                db.add(
                    Comment(
                        ticket=ticket,
                        author_id=actor.id,
                        visibility="public",
                        created_at=moment,
                        body="Приняли в работу, специалист уже в курсе.",
                    )
                )
            old = status
            ticket.status = status
            if status in ("resolved", "rejected"):
                ticket.closed_at = moment
        ticket.updated_at = moment
        if rating and ticket.status == "resolved":
            ticket.rating = rating
            db.add(
                TicketHistory(
                    ticket=ticket,
                    action="rated",
                    new_value=str(rating),
                    actor_label="Заявитель",
                    created_at=moment + timedelta(hours=2),
                )
            )

    for i, (text, kind, cat) in enumerate(DEMO_AI_QUESTIONS):
        db.add(
            AiLog(
                created_at=now - timedelta(days=rnd.uniform(0, 10), minutes=i),
                message=text,
                kind=kind,
                category_code=cat,
                confidence=1.0 if kind in ("danger", "secret") else round(rnd.uniform(0.7, 0.95), 2),
                engine="safety" if kind in ("danger", "secret") else "fallback",
                answer="",
                latency_ms=rnd.randint(5, 30),
            )
        )
    db.commit()


def seed(db: Session, demo_tickets: bool = True) -> None:
    seed_reference(db)
    if demo_tickets:
        seed_demo_tickets(db)


def main() -> None:
    parser = argparse.ArgumentParser(description="Заполнить базу начальными данными")
    parser.add_argument("--reset", action="store_true", help="удалить все данные и создать заново")
    parser.add_argument("--clean", action="store_true", help="без демонстрационных заявок")
    args = parser.parse_args()

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if args.reset:
        reset_db()
    init_db()
    with SessionLocal() as db:
        seed(db, demo_tickets=not args.clean)
    print("Готово. Логины: admin, upk, electric, it, service, cleaning")


if __name__ == "__main__":
    main()
