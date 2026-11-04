"""HTML-страницы и служебные файлы для браузеров и поисковиков."""

import hashlib

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response

from ..config import WEB_DIR, settings

router = APIRouter(include_in_schema=False)


def page(name: str, request: Request, status_code: int = 200) -> Response:
    html = (WEB_DIR / name).read_text(encoding="utf-8").replace("%PUBLIC_URL%", settings.public_url)
    etag = f'"{hashlib.sha256(html.encode()).hexdigest()[:20]}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if status_code == 200 and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(html, status_code=status_code, headers=headers)


@router.api_route("/", methods=["GET", "HEAD"])
@router.get("/r/{qr_key}")
def report_page(request: Request, qr_key: str | None = None):
    return page("index.html", request)


@router.get("/track")
@router.get("/t/{code}")
def track_page(request: Request, code: str | None = None):
    return page("track.html", request)


@router.get("/admin")
def admin_page(request: Request):
    return page("admin.html", request)


@router.get("/admin/qr-print")
def qr_print_page(request: Request):
    return page("qr-print.html", request)


@router.get("/privacy")
def privacy_page(request: Request):
    return page("privacy.html", request)


@router.get("/robots.txt")
def robots():
    return PlainTextResponse(
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /admin\n"
        "Disallow: /api/\n"
        "Disallow: /r/\n"
        "Disallow: /t/\n"
        "Disallow: /track\n"
        f"\nSitemap: {settings.public_url}/sitemap.xml\n"
    )


@router.get("/sitemap.xml")
def sitemap():
    urls = "".join(f"<url><loc>{settings.public_url}{path}</loc></url>" for path in ("/", "/privacy"))
    body = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return Response(body, media_type="application/xml")


@router.get("/manifest.webmanifest")
def manifest():
    return FileResponse(WEB_DIR / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@router.get("/favicon.ico")
def favicon():
    return FileResponse(WEB_DIR / "static" / "img" / "icon.svg", media_type="image/svg+xml")
