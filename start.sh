#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
echo "Открывайте http://localhost:8000  (панель: http://localhost:8000/admin)"
exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
