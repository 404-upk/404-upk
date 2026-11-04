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
