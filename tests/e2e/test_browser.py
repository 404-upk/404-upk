"""Сквозные сценарии в браузере: заявитель, статус, панель УПК, тема, телефон, работа без сети."""

import re

from playwright.sync_api import expect

from .conftest import QR_214, create_ticket, login_admin

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


def test_theme_switch_is_remembered(page):
    page.goto("/")
    root = page.locator("html")
    before = root.get_attribute("data-theme") or "dark"
    page.click("#theme")
    after = "light" if before == "dark" else "dark"
    expect(root).to_have_attribute("data-theme", after)
    page.reload()
    expect(root).to_have_attribute("data-theme", after)


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
