import asyncio
import time
import uuid

import httpx

from ..config import settings

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
API_URL = "https://gigachat.devices.sberbank.ru/api/v1"


class GigaChatError(Exception):
    pass


class GigaChatClient:
    """Минимальный клиент GigaChat API: токен, чат и загрузка картинок."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()
        self._client: httpx.AsyncClient | None = None

    @property
    def enabled(self) -> bool:
        return settings.gigachat_enabled

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(verify=settings.gigachat_verify, timeout=settings.gigachat_timeout)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get_token(self) -> str:
        async with self._lock:
            if self._token and time.time() < self._expires_at - 60:
                return self._token
            try:
                resp = await self._http().post(
                    OAUTH_URL,
                    headers={
                        "Authorization": f"Basic {settings.gigachat_auth_key}",
                        "RqUID": str(uuid.uuid4()),
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data={"scope": settings.gigachat_scope},
                )
            except httpx.HTTPError as exc:
                raise GigaChatError(f"нет связи с сервером авторизации: {exc}") from exc
            if resp.status_code != 200:
                raise GigaChatError(f"авторизация не прошла: {resp.status_code} {resp.text[:200]}")
            payload = resp.json()
            self._token = payload["access_token"]
            # expires_at приходит в миллисекундах
            self._expires_at = payload.get("expires_at", 0) / 1000 or time.time() + 1500
            return self._token

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        for attempt in range(2):
            token = await self._get_token()
            headers = kwargs.pop("headers", {})
            headers["Authorization"] = f"Bearer {token}"
            try:
                resp = await self._http().request(method, f"{API_URL}{path}", headers=headers, **kwargs)
            except httpx.HTTPError as exc:
                raise GigaChatError(f"нет связи с GigaChat: {exc}") from exc
            if resp.status_code == 401 and attempt == 0:
                self._token = None
                continue
            if resp.status_code >= 400:
                raise GigaChatError(f"GigaChat ответил {resp.status_code}: {resp.text[:200]}")
            return resp
        raise GigaChatError("не удалось авторизоваться в GigaChat")

    async def chat(
        self,
        messages: list[dict],
        *,
        model: str | None = None,
        temperature: float = 0.1,
        max_tokens: int = 900,
    ) -> str:
        resp = await self._request(
            "POST",
            "/chat/completions",
            json={
                "model": model or settings.gigachat_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        try:
            return resp.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as exc:
            raise GigaChatError("неожиданный формат ответа") from exc

    async def upload_image(self, data: bytes, filename: str = "photo.jpg") -> str:
        resp = await self._request(
            "POST",
            "/files",
            files={"file": (filename, data, "image/jpeg")},
            data={"purpose": "general"},
        )
        return resp.json()["id"]

    async def delete_file(self, file_id: str) -> None:
        try:
            await self._request("POST", f"/files/{file_id}/delete")
        except GigaChatError:
            pass


client = GigaChatClient()
