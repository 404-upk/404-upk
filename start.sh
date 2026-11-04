#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
if ! grep -q '^GIGACHAT_AUTH_KEY=.' .env; then
  echo "Помощник работает через GigaChat, для этого нужен ключ. Его выдаёт капитан команды."
  printf "Вставьте ключ и нажмите Enter (пусто: запустить в демо-режиме без GigaChat): "
  read -r GKEY || GKEY=""
  if [ -n "$GKEY" ]; then
    GKEY="$GKEY" .venv/bin/python -c "import os, pathlib, re; k = re.sub(r'^GIGACHAT_AUTH_KEY\s*=\s*', '', os.environ['GKEY'].strip()).strip(chr(34) + chr(39) + ' '); p = pathlib.Path('.env'); s = p.read_text(encoding='utf-8'); p.write_text(re.sub(r'(?m)^GIGACHAT_AUTH_KEY=.*$', lambda m: 'GIGACHAT_AUTH_KEY=' + k, s), encoding='utf-8')"
    echo "Ключ сохранён в .env на этом компьютере, в репозиторий он не попадёт."
  fi
fi
echo "Открывайте http://localhost:8000  (панель: http://localhost:8000/admin)"
exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
