#!/usr/bin/env sh
# Запускает сайт в Codespaces. С настоящим адресом работают вход, QR-коды и ссылки.
if [ -n "$CODESPACE_NAME" ]; then
  export PUBLIC_URL="https://${CODESPACE_NAME}-8000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi
[ -f .env ] || cp .env.example .env
nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/upk.log 2>&1 &
