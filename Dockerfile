FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/data

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt \
    && useradd --system --uid 10001 --home-dir /srv --shell /usr/sbin/nologin upk \
    && mkdir -p /data \
    && chown upk:upk /data

COPY app ./app
COPY web ./web
COPY certs ./certs

# сервер работает без прав root
USER upk
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]
# заголовкам прокси можно доверять: порт приложения открыт только для Caddy (см. deploy/)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
