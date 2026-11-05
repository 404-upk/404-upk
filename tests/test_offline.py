"""Работа без сети: Service Worker отдаётся из корня сайта и не сохраняет закрытые данные."""

from app.config import WEB_DIR


def test_service_worker_is_served_from_root(client):
    resp = client.get("/sw.js")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/javascript")
    assert resp.headers["service-worker-allowed"] == "/"
    # браузер должен каждый раз сверять работника с сервером, иначе обновление сайта не дойдёт
    assert resp.headers["cache-control"] == "no-cache"


def test_service_worker_does_not_cache_private_pages():
    source = (WEB_DIR / "sw.js").read_text(encoding="utf-8")
    # панель, коды отслеживания и закрытые запросы к API в копию на устройстве не попадают
    assert "SKIP = /^\\/(admin|t\\/|api\\/|sw\\.js)/" in source
    assert "PUBLIC_API = /^\\/api\\/(meta|campus|locations(\\/qr\\/[^/]+)?)$/" in source


def test_every_page_loads_page_transition():
    # форма искры и переход живут в обычном скрипте: без него не откроется ни смена темы, ни переход
    for name in ["index", "track", "privacy", "404", "admin", "qr-print"]:
        assert "/static/js/page-transition.js" in (WEB_DIR / f"{name}.html").read_text(encoding="utf-8"), name
    worker = (WEB_DIR / "sw.js").read_text(encoding="utf-8")
    for script in ["page-transition.js", "sound.js", "selection.js", "lift.js"]:
        assert f"/static/js/{script}" in worker, script


def test_svg_is_compressed_but_fonts_are_not(client):
    # SVG это текст и хорошо сжимается, а шрифты уже сжаты
    svg = client.get("/static/img/lockup.svg", headers={"Accept-Encoding": "gzip"})
    assert svg.headers.get("content-encoding") == "gzip"
    font = client.get("/static/fonts/inter-400-lat.woff2", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in font.headers
