"""Сквозные сценарии в браузере: заявитель, статус, панель УПК, тема, телефон, работа без сети."""

import re

from playwright.sync_api import expect

from .conftest import QR_214, create_ticket, login_admin, submit_admin_login

HSCROLL = "document.documentElement.scrollWidth > window.innerWidth + 1"


def test_report_from_qr_to_status_page(page):
    """Подача заявки от начала до конца: QR-код кабинета, ответ помощника, форма, код, страница статуса."""
    page.goto(f"/r/{QR_214}")
    expect(page.locator("#place")).to_contain_text("Кабинет 214")

    page.fill("#message", "В кабинете не работает проектор, экран не включается")
    page.click("#ask-btn")
    expect(page.locator("#d-desc")).to_be_visible()  # помощник предложил оформить заявку

    page.fill("#d-title", "Не работает проектор")
    page.fill("#d-contact", "Группа ИС-21")
    page.click("#submit-btn")

    number = page.locator(".ticket-number")
    expect(number).to_have_text(re.compile(r"УПК-\d{4}"))
    public_number = number.inner_text()
    expect(page.locator(".code-box")).to_be_visible()

    page.get_by_role("link", name="Открыть статус").click()
    expect(page).to_have_url(re.compile(r"/t/"))
    expect(page.locator("#app")).to_contain_text(public_number)
    expect(page.locator("#app")).to_contain_text("Не работает проектор")


def test_status_page_by_code(page):
    """Статус по коду отслеживания: страница поиска и страница заявки."""
    ticket = create_ticket(page, "Мигает свет над доской")
    page.goto("/track")
    page.fill("#code", ticket["code"])
    page.keyboard.press("Enter")
    expect(page.locator("#app")).to_contain_text(ticket["public_number"])
    expect(page.locator("#app")).to_contain_text("Мигает свет над доской")


def test_admin_login_and_status_change(page):
    """Вход в панель, карточка заявки, смена статуса; заявитель видит новый статус."""
    ticket = create_ticket(page, "Сломан стул у окна", category="furniture")
    login_admin(page)
    page.goto("/admin#/tickets")
    page.get_by_role("link", name="Сломан стул у окна").first.click()

    drawer = page.locator(".drawer")
    expect(drawer).to_contain_text(ticket["public_number"])
    drawer.locator('[data-status="review"]').click()
    expect(drawer.locator(".drawer-head")).to_contain_text("На рассмотрении")

    page.goto(f"/t/{ticket['code'].replace('-', '')}")
    expect(page.locator("#app")).to_contain_text("На рассмотрении")


def test_board_move_with_mouse_and_keyboard(page):
    """Доска: перенос карточки перетаскиванием и с клавиатуры (Shift + стрелка)."""
    by_mouse = create_ticket(page, "Нет интернета у окна", category="network")
    by_keys = create_ticket(page, "Не работает розетка у двери", category="electricity")
    login_admin(page)
    page.goto("/admin#/board")

    card = page.locator(f'.kcard[data-id="{by_mouse["id"]}"]')
    expect(card).to_be_visible()
    card.drag_to(page.locator('.col[data-status="review"]'))
    expect(page.locator(f'.col[data-status="review"] .kcard[data-id="{by_mouse["id"]}"]')).to_be_visible()

    card = page.locator(f'.kcard[data-id="{by_keys["id"]}"]')
    card.focus()
    page.keyboard.press("Shift+ArrowRight")
    moved = page.locator(f'.col[data-status="review"] .kcard[data-id="{by_keys["id"]}"]')
    expect(moved).to_be_visible()
    expect(moved).to_be_focused()


def test_theme_picker_and_choice_is_remembered(page):
    """Меню темы: четыре темы с названиями, выбор мышью и с клавиатуры, выбор сохраняется после перезагрузки."""
    page.goto("/")
    root = page.locator("html")
    expect(root).to_have_attribute("data-theme", "dark")

    page.click("#theme")
    menu = page.get_by_role("menu", name="Тема оформления")
    expect(menu.get_by_role("menuitemradio")).to_have_text(
        [re.compile("Полночь"), re.compile("Горный снег"), re.compile("Кромешная тьма"), re.compile("Небо")]
    )
    expect(menu.get_by_role("menuitemradio", name=re.compile("Полночь"))).to_have_attribute("aria-checked", "true")
    menu.get_by_role("menuitemradio", name=re.compile("Кромешная тьма")).click()
    expect(root).to_have_attribute("data-theme", "black")
    expect(menu).to_have_count(0)

    # с клавиатуры: открыть, стрелкой вверх на «Горный снег», Enter
    page.locator("#theme").focus()
    page.keyboard.press("Enter")
    page.keyboard.press("ArrowUp")
    page.keyboard.press("Enter")
    expect(root).to_have_attribute("data-theme", "light")
    expect(page.locator("#theme")).to_be_focused()

    page.reload()
    expect(root).to_have_attribute("data-theme", "light")
    expect(page.locator("#theme")).to_have_attribute("aria-label", "Тема: Горный снег. Выбрать тему")


def test_phone_width_has_no_horizontal_scroll(phone):
    """Ширина 360 px: страницы без горизонтальной прокрутки, план этажа открывается касанием."""
    for path in ("/", "/track", "/admin", "/privacy"):
        phone.goto(path)
        phone.wait_for_load_state("networkidle")
        assert not phone.evaluate(HSCROLL), f"горизонтальная прокрутка на {path}"

    phone.goto("/")
    phone.locator('.pf-floor[data-floor="2"] .pf-floor-bg').tap(position={"x": 12, "y": 30})
    expect(phone.locator(".fv")).to_be_visible()
    expect(phone.locator("#fv-title")).to_have_text("2 этаж")
    assert not phone.evaluate(
        "document.querySelector('.fv-body').scrollWidth > document.querySelector('.fv-body').clientWidth + 1"
    )


def test_page_opens_offline_and_message_is_sent_when_back_online(page):
    """Без сети: страница открывается из копии на устройстве, сообщение уходит само, когда связь вернулась."""
    page.goto("/")
    page.evaluate("navigator.serviceWorker.ready")
    page.reload()
    expect(page.locator(".pf")).to_be_visible()

    page.context.set_offline(True)
    page.reload()
    expect(page.locator("h1")).to_have_text("Что случилось?")
    expect(page.locator(".net-banner")).to_be_visible()

    page.fill("#message", "В кабинете 214 не работает проектор")
    page.click("#ask-btn")
    expect(page.locator("#thread .notice-danger")).to_contain_text("уйдёт само")

    page.context.set_offline(False)
    expect(page.locator("#thread .notice-danger")).to_have_count(0)
    expect(page.locator("#d-desc")).to_be_visible()


def test_own_tooltip_and_context_menu(page):
    """Подсказки и меню по правой кнопке в стиле сайта; в поле ввода своё меню правки текста."""
    page.goto("/")
    page.hover("#theme")
    expect(page.locator(".ui-tip.is-on")).to_have_text("Тема: Полночь")
    assert page.locator("#theme").get_attribute("title") is None  # системной подсказки нет

    page.mouse.click(640, 720, button="right")
    menu = page.get_by_role("menu", name="Действия на странице")
    expect(menu).to_be_visible()
    expect(menu.get_by_role("menuitem", name=re.compile("Обновить страницу"))).to_be_visible()
    menu.get_by_role("menuitem", name="Тема оформления").hover()
    # у каждой темы свой знак
    expect(page.locator(".ctx-sub .theme-swatch svg > *:first-child")).to_have_count(4)
    page.get_by_role("menuitemradio", name=re.compile("Горный снег")).click()
    expect(page.locator("html")).to_have_attribute("data-theme", "light")
    expect(menu).to_have_count(0)

    page.locator("#message").click(button="right")
    expect(page.get_by_role("menu", name="Действия с полем")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".ctx-menu")).to_have_count(0)
    # с зажатым Shift остаётся меню браузера
    page.locator("#message").click(button="right", modifiers=["Shift"])
    expect(page.locator(".ctx-menu")).to_have_count(0)


def test_sky_theme_is_applied_and_remembered(page):
    """Тема «Небо» применяется вместе со своим фоном и сохраняется после перезагрузки."""
    page.goto("/")
    root = page.locator("html")
    page.click("#theme")
    page.get_by_role("menu", name="Тема оформления").get_by_role("menuitemradio", name=re.compile("Небо")).click()
    expect(root).to_have_attribute("data-theme", "sky")
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()") == "#b7cbf0"
    assert "gradient" in page.evaluate("getComputedStyle(document.body, '::before').backgroundImage")
    page.reload()
    expect(root).to_have_attribute("data-theme", "sky")
    assert page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1") is False


def test_add_room_and_print_its_qr(page):
    """«Добавить» открывает форму, новое помещение появляется в списке, страница печати кладёт его код на лист."""
    login_admin(page)
    page.goto("/admin#/locations")
    page.click("#add-loc")
    page.fill("#lf-f", "5")
    page.fill("#lf-r", "512а")
    page.keyboard.press("Enter")

    row = page.locator("tr", has_text="Кабинет 512а")
    expect(row).to_be_visible()
    page.goto(row.get_by_role("link", name="Напечатать этот код").get_attribute("href"))
    expect(page.locator(".print-card")).to_have_count(1)
    expect(page.locator(".print-card h2")).to_have_text("Кабинет 512а")
    expect(page.locator("#qp-print")).to_contain_text("1 лист")


def test_print_page_splits_codes_into_sheets_and_prints_them(page):
    """Раскладка делит коды на листы A4; PDF содержит столько же страниц, без пустых в конце; поиск и выбор работают."""
    login_admin(page)
    page.goto("/admin/qr-print")
    cards = page.locator(".print-card")
    expect(cards.first).to_be_visible()
    total = cards.count()

    page.click('[data-layout="1"]')
    expect(page.locator(".sheet")).to_have_count(total)
    page.click('[data-layout="6"]')
    sheets = (total + 5) // 6
    expect(page.locator(".sheet")).to_have_count(sheets)
    overflow = "[...document.querySelectorAll('.print-card')].filter(c => c.scrollHeight > c.clientHeight + 1).length"
    assert page.evaluate(overflow) == 0

    page.emulate_media(media="print")
    page.evaluate("Promise.all([...document.images].map((i) => i.decode()))")
    pdf = page.pdf(prefer_css_page_size=True)
    page.emulate_media(media="screen")
    assert len(re.findall(rb"/Type\s*/Page\b(?!s)", pdf)) == sheets

    page.fill("#qp-q", "214")
    page.click("#qp-all")
    expect(cards).to_have_count(total - page.locator("[data-room]:not([hidden])").count())
    page.fill("#qp-q", "")
    page.click("#qp-all")
    expect(cards).to_have_count(total)
    page.click("#qp-all")
    expect(page.locator("#qp-print")).to_be_disabled()
    expect(page.locator(".qp-empty")).to_be_visible()


def test_qr_is_carried_with_own_animation(page):
    """QR-код не тащится системной копией: своя копия идёт за мышью и исчезает, вернувшись на место."""
    page.emulate_media(reduced_motion="no-preference")
    login_admin(page)
    page.goto("/admin/qr-print")
    img = page.locator(".print-qr").first
    expect(img).to_be_visible()
    assert img.evaluate("(el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))")

    box = img.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 90, y + 50, steps=6)
    ghost = page.locator(".qr-lift")
    expect(ghost).to_be_visible()
    expect(img).to_have_class(re.compile("is-lifted"))
    page.mouse.up()
    expect(ghost).to_have_count(0)
    expect(img).not_to_have_class(re.compile("is-lifted"))


def test_new_employee_form_has_own_suggestions(page):
    """В форме сотрудника нет поля пароля для менеджера браузера: логины предлагает сайт, пароль придумывается кнопкой."""
    login_admin(page)
    page.goto("/admin#/users")
    page.click("#u-add")
    expect(page.locator('.modal input[type="password"]')).to_have_count(0)

    page.fill("#u-name", "Иван Петров")
    page.click("#u-nick")
    option = page.get_by_role("option", name="i.petrov", exact=True)
    expect(option).to_be_visible()
    option.click()
    expect(page.locator("#u-nick")).to_have_value("i.petrov")
    expect(page.locator(".login-menu")).to_have_count(0)

    page.fill("#u-nick", "admin")
    expect(page.locator("#u-nick-hint")).to_have_text("Такой логин уже занят")
    # Escape закрывает открытый список логинов, а окно с формой остаётся
    page.fill("#u-nick", "")
    expect(page.locator(".login-menu")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".login-menu")).to_have_count(0)
    expect(page.locator(".modal")).to_be_visible()
    page.fill("#u-nick", "i.petrov")

    page.click("#u-gen")
    assert len(page.input_value("#u-secret")) == 14
    page.click("#u-save")
    expect(page.locator("td.mono", has_text="i.petrov")).to_be_visible()


def test_link_has_no_system_bar_or_drag_and_still_opens(page):
    """Пока кнопка зажата, адрес спрятан от браузера: вместо его строки и копии своя карточка. Клик открывает ссылку."""
    page.emulate_media(reduced_motion="no-preference")
    page.goto("/")
    link = page.locator('a[href="/privacy"], a[data-href="/privacy"]').first
    link.scroll_into_view_if_needed()
    box = link.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    page.mouse.move(x, y)
    expect(page.locator(".ui-link.is-on")).to_be_visible()
    assert link.get_attribute("href") is None

    page.mouse.down()
    assert link.get_attribute("href") is None
    page.mouse.move(x + 70, y - 80, steps=6)
    chip = page.locator(".link-lift")
    expect(chip).to_be_visible()
    expect(chip).to_contain_text("Обработка данных")
    page.mouse.move(x, y, steps=6)
    page.mouse.up()
    expect(chip).to_have_count(0)
    assert "/privacy" not in page.url

    page.mouse.move(x, y + 1)
    page.mouse.down()
    page.mouse.up()
    expect(page).to_have_url(re.compile("/privacy"))


def _menu(page):
    return page.get_by_role("menu", name="Действия на странице")


def test_employee_is_deleted_from_context_menu(page):
    """Сотрудника удаляют правой кнопкой, себя удалить нельзя; действия показывают, с кем работаем."""
    login_admin(page)
    created = page.request.post(
        "/api/manage/users",
        data={"name": "Временный Сотрудник", "login": "temp.worker", "role": "executor", "password": "temp-password-1"},
    )
    assert created.ok, created.text()
    page.goto("/admin#/users")

    row = page.locator("tr[data-user]", has_text="temp.worker")
    row.click(button="right")
    expect(_menu(page).locator(".ctx-title")).to_have_text("Временный Сотрудник")
    expect(row).to_have_class(re.compile("ctx-target"))
    _menu(page).get_by_role("menuitem", name=re.compile("Удалить")).click()
    page.get_by_role("dialog").get_by_role("button", name="Удалить").click()
    expect(row).to_have_count(0)

    page.locator("tr[data-user]", has_text="Администратор системы").click(button="right")
    expect(_menu(page).get_by_role("menuitem", name=re.compile("Удалить"))).to_be_disabled()
    page.keyboard.press("Escape")
    expect(_menu(page)).to_have_count(0)


def test_ticket_is_changed_from_context_menu(page):
    """Приоритет, исполнитель и статус меняются через подменю, в списке и на доске, мышью и с клавиатуры."""
    create_ticket(page, "Скрипит дверь в кабинете")
    login_admin(page)
    page.goto("/admin#/tickets")
    row = page.locator("tr", has_text="Скрипит дверь в кабинете")

    row.click(button="right")
    _menu(page).get_by_role("menuitem", name="Приоритет").hover()
    page.get_by_role("menuitemradio", name="Высокий").click()
    expect(row).to_contain_text("Высокий")

    # клавиатура: подменю открывается стрелкой вправо, закрывается стрелкой влево, меню остаётся
    row.click(button="right")
    _menu(page).get_by_role("menuitem", name="Исполнитель").focus()
    page.keyboard.press("ArrowRight")
    expect(page.locator(".ctx-sub:not(.is-leaving)")).to_be_visible()
    page.keyboard.press("ArrowLeft")
    expect(page.locator(".ctx-sub")).to_have_count(0)
    expect(_menu(page).get_by_role("menuitem", name="Исполнитель")).to_be_focused()

    _menu(page).get_by_role("menuitem", name="Исполнитель").click()
    page.get_by_role("menuitemradio", name=re.compile("Шамиль Алиев")).click()
    expect(row).to_contain_text("Шамиль Алиев")

    page.goto("/admin#/board")
    card = page.locator(".kcard", has_text="Скрипит дверь в кабинете")
    card.click(button="right")
    _menu(page).get_by_role("menuitem", name="Статус").hover()
    page.get_by_role("menu", name="Статус").get_by_role("menuitem", name="В работе").click()
    expect(page.locator('.col[data-status="in_progress"] .kcard', has_text="Скрипит дверь в кабинете")).to_be_visible()

    # статус с обязательным комментарием спрашивает его, отмена ничего не меняет
    card.click(button="right")
    _menu(page).get_by_role("menuitem", name="Статус").hover()
    page.get_by_role("menu", name="Статус").get_by_role("menuitem", name="Решена").click()
    page.get_by_role("dialog").get_by_role("button", name="Отмена").click()
    expect(page.locator('.col[data-status="in_progress"] .kcard', has_text="Скрипит дверь в кабинете")).to_be_visible()


def test_room_is_deleted_from_context_menu_only_without_tickets(page):
    """Помещение без заявок удаляется правой кнопкой, с заявками кнопка недоступна."""
    login_admin(page)
    created = page.request.post(
        "/api/manage/locations",
        data={"building": "Корпус 1", "floor": 7, "room": "777", "kind": "room", "is_active": True},
    )
    assert created.ok, created.text()
    page.goto("/admin#/locations")

    row = page.locator("tr", has_text="Кабинет 777")
    row.click(button="right")
    _menu(page).get_by_role("menuitem", name=re.compile("Удалить")).click()
    page.get_by_role("dialog").get_by_role("button", name="Удалить").click()
    expect(row).to_have_count(0)

    page.locator("tr", has_text="Главный холл").click(button="right")
    expect(_menu(page).get_by_role("menuitem", name=re.compile("Удалить"))).to_be_disabled()
    page.keyboard.press("Escape")

    # действия раздела видны и без строки, а в другом разделе их нет
    page.locator("#content h1, .main-head").first.click(button="right")
    expect(_menu(page).get_by_role("menuitem", name="Добавить помещение")).to_be_visible()
    page.keyboard.press("Escape")
    page.goto("/admin#/stats")
    page.locator(".main-head").first.click(button="right")
    expect(_menu(page).get_by_role("menuitem", name="Добавить помещение")).to_have_count(0)


def test_new_article_form_opens_and_article_is_deleted_from_context_menu(page):
    """«Новая статья» открывает форму, а статью можно удалить правой кнопкой."""
    login_admin(page)
    page.goto("/admin#/kb")
    page.click("#kb-add")
    page.fill("#kb-q", "Проверочная статья для удаления")
    page.fill("#kb-a", "Проверочный ответ для удаления статьи")
    page.click("#kb-save")
    card = page.locator(".card[data-id]", has_text="Проверочная статья для удаления")
    expect(card).to_be_visible()

    card.click(button="right")
    _menu(page).get_by_role("menuitem", name=re.compile("Удалить")).click()
    page.get_by_role("dialog").get_by_role("button", name="Удалить").click()
    expect(card).to_have_count(0)


def test_text_field_has_own_context_menu(page):
    """В поле ввода своё меню: выделить, вырезать, отменить, вставить; у пустого поля лишнее недоступно."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.goto("/")
    box = page.locator("#message")
    field_menu = page.get_by_role("menu", name="Действия с полем")

    box.click(button="right")
    expect(field_menu.get_by_role("menuitem", name=re.compile("Копировать"))).to_be_disabled()
    expect(field_menu.get_by_role("menuitem", name=re.compile("Выделить всё"))).to_be_disabled()
    page.keyboard.press("Escape")

    box.fill("Сломался проектор")
    box.click(button="right")
    field_menu.get_by_role("menuitem", name=re.compile("Выделить всё")).click()
    assert box.evaluate("(el) => el.value.slice(el.selectionStart, el.selectionEnd)") == "Сломался проектор"
    expect(box).to_be_focused()

    box.click(button="right", position={"x": 30, "y": 16})
    box.evaluate("(el) => el.select()")
    page.keyboard.press("Escape")
    box.evaluate(
        "(el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))"
    )
    field_menu.get_by_role("menuitem", name=re.compile("Вырезать")).click()
    expect(box).to_have_value("")

    box.evaluate(
        "(el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))"
    )
    field_menu.get_by_role("menuitem", name=re.compile("Вставить")).click()
    expect(box).to_have_value("Сломался проектор")

    box.evaluate(
        "(el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))"
    )
    field_menu.get_by_role("menuitem", name=re.compile("Очистить")).click()
    expect(box).to_have_value("")


def test_login_has_own_menu_and_no_password_field(page):
    """На входе нет поля type="password", символы пароля скрыты, недавние логины предлагает сайт."""
    page.goto("/admin")
    expect(page.locator('input[type="password"]')).to_have_count(0)
    secret = page.locator("#l-secret")
    assert secret.evaluate("(el) => getComputedStyle(el).webkitTextSecurity") == "disc"
    secret.fill("секретный пароль")
    secret.click(button="right")
    field_menu = page.get_by_role("menu", name="Действия с полем")
    expect(field_menu.get_by_role("menuitem", name=re.compile("Копировать"))).to_be_disabled()
    page.keyboard.press("Escape")
    secret.fill("")

    submit_admin_login(page)
    page.click("#logout")
    expect(page.locator("#l-nick")).to_be_visible()
    page.click("#l-nick")
    option = page.get_by_role("option", name="admin", exact=True)
    expect(option).to_be_visible()
    option.click()
    expect(page.locator("#l-nick")).to_have_value("admin")
    expect(secret).to_be_focused()

    page.click("#l-nick")
    page.get_by_role("option", name="Забыть логины на этом устройстве").click()
    page.fill("#l-nick", "")
    page.click("#l-nick")
    expect(page.get_by_role("option", name="admin", exact=True)).to_have_count(0)


def test_floor_plan_stairs_match_the_floor(page):
    """На плане этажа лестница ведёт туда, куда с него можно попасть; коридор сквозной; на 1 этаже есть вход."""
    page.goto("/")
    page.locator('.pf-floor[data-floor="1"] .pf-floor-bg').click(position={"x": 8, "y": 30}, force=True)
    plan = page.locator(".fv-plan")
    expect(plan).to_be_visible()
    expect(page.locator(".fv-entry")).to_be_visible()
    expect(plan.locator(".fs-to.is-up")).to_have_count(2)
    expect(plan.locator(".fs-to.is-down")).to_have_count(0)

    tabs = page.locator(".fv-tabs")
    tabs.get_by_role("button", name="3 этаж").click()
    expect(plan.locator(".fs-to.is-up")).to_have_count(0)
    expect(plan.locator(".fs-to.is-down")).to_have_count(2)
    expect(page.locator(".fv-entry")).to_have_count(0)

    tabs.get_by_role("button", name="2 этаж").click()
    expect(plan.locator(".fs-to.is-up")).to_have_count(2)
    expect(plan.locator(".fs-to.is-down")).to_have_count(2)
    # коридор идёт на одной высоте через лестничные клетки и середину этажа
    tops = plan.locator(".fv-hall, .fv-corridor").evaluate_all(
        "(els) => els.map((e) => Math.round(e.getBoundingClientRect().top))"
    )
    assert len(tops) == 5 and len(set(tops)) == 1, tops


def test_text_selection_has_own_color_and_sparks(page):
    """У выделения свой цвет в каждой теме, края держат две искры; без выделения искр нет."""
    page.goto("/")
    title = page.locator("h1").first
    color = "(el) => getComputedStyle(el, '::selection').backgroundColor"
    assert "106, 134, 190" in title.evaluate(color)

    title.evaluate("(el) => getSelection().selectAllChildren(el)")
    sparks = page.locator(".sel-spark.is-on")
    expect(sparks).to_have_count(2)
    start = page.locator(".sel-spark.is-start").bounding_box()
    box = title.bounding_box()
    assert abs(start["x"] - box["x"]) < 3

    page.evaluate("getSelection().removeAllRanges()")
    expect(sparks).to_have_count(0)

    # в поле ввода браузер не отдаёт координаты выделения: только цвет, искр нет
    page.fill("#message", "Сломался проектор")
    page.locator("#message").evaluate("(el) => { el.focus(); el.select(); }")
    expect(sparks).to_have_count(0)

    page.evaluate("document.documentElement.dataset.theme = 'sky'")
    assert "39, 64, 122" in title.evaluate(color)


def test_page_transition_opens_with_spark_and_goes_back(page):
    """Переход между страницами идёт через свой сценарий вперёд и назад и не ломает страницу."""
    page.emulate_media(reduced_motion="no-preference")
    page.goto("/")
    link = page.locator('a[href="/privacy"], a[data-href="/privacy"]').first
    link.scroll_into_view_if_needed()
    link.click()
    expect(page).to_have_url(re.compile("/privacy"))
    expect(page.locator("html")).to_have_attribute("data-nav", "forward")

    page.go_back()
    expect(page).to_have_url(re.compile(r"/$"))
    expect(page.locator("html")).to_have_attribute("data-nav", "back")
    expect(page.locator("html")).not_to_have_class(re.compile("vt-collapse"))


def test_admin_section_opens_with_spark(page):
    """Раздел панели раскрывается анимацией от клика; при первой загрузке анимации нет."""
    page.emulate_media(reduced_motion="no-preference")
    login_admin(page)
    page.goto("/admin#/tickets")
    expect(page.locator("#list")).to_be_visible()
    page.get_by_role("link", name="База знаний").click()
    expect(page.locator(".card[data-id]").first).to_be_visible()


def test_sound_is_quiet_and_can_be_switched_off(page):
    """Звук не перегружен и не пуст, выключатель работает и запоминается."""
    page.goto("/")
    for kind, limit in (("intro", 0.6), ("forward", 0.3), ("back", 0.3), ("section", 0.25)):
        result = page.evaluate("(kind) => import('/static/js/sound.js').then((m) => m.measureSound(kind))", kind)
        assert 0.01 < result["peak"] < limit, (kind, result)
        assert result["envelope"][-1] < result["peak"] / 4, (kind, result)

    button = page.locator(".sound-btn")
    expect(button).to_have_attribute("aria-pressed", "true")
    button.click()
    expect(button).to_have_attribute("aria-pressed", "false")
    page.reload()
    expect(page.locator(".sound-btn")).to_have_attribute("aria-pressed", "false")

    page.mouse.click(640, 720, button="right")
    expect(
        page.get_by_role("menu", name="Действия на странице").get_by_role("menuitem", name="Включить звук")
    ).to_be_visible()


def test_phone_header_keeps_all_buttons_whole(phone):
    """На узком экране кнопки шапки не обрезаются и не выходят за край."""
    phone.goto("/")
    link = phone.locator(".topbar").get_by_role("link", name="Мои заявки")
    expect(link).to_be_visible()
    assert link.evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
    for selector in (".sound-btn", "#theme"):
        box = phone.locator(selector).bounding_box()
        assert box["x"] + box["width"] <= 360
    assert phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
