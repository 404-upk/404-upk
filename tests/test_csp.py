"""Строгая политика стилей: без unsafe-inline и без style="" в разметке."""

import re

from app.config import WEB_DIR


def test_styles_only_from_files(client):
    csp = client.get("/").headers["content-security-policy"]
    style_src = next(part.strip() for part in csp.split(";") if part.strip().startswith("style-src"))
    assert style_src == "style-src 'self'"


def test_no_inline_style_attributes_in_markup():
    # такой атрибут CSP заблокирует, и элемент молча потеряет оформление; значения задаются классами
    # или из JS через element.style (data-css-i, data-css-pct в core.js)
    found = []
    for path in [*WEB_DIR.glob("*.html"), *WEB_DIR.glob("static/js/**/*.js")]:
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r'\sstyle="', line) and not line.lstrip().startswith("//"):
                found.append(f"{path.relative_to(WEB_DIR)}:{n}")
    assert not found, f'style="" в разметке: {found}'
