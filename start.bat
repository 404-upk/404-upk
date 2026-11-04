@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
  echo Создаю окружение...
  python -m venv .venv || goto :error
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\pip install -q -r requirements.txt || goto :error
)
if not exist .env copy .env.example .env >nul
findstr /r /c:"^GIGACHAT_AUTH_KEY=." .env >nul && goto run
echo.
echo Помощник работает через GigaChat, для этого нужен ключ. Его выдаёт капитан команды.
set "GKEY="
set /p "GKEY=Вставьте ключ и нажмите Enter (пусто: запустить в демо-режиме без GigaChat): "
if not defined GKEY goto run
.venv\Scripts\python -c "import os, pathlib, re; p = pathlib.Path('.env'); s = p.read_text(encoding='utf-8'); p.write_text(re.sub(r'(?m)^GIGACHAT_AUTH_KEY=.*$', 'GIGACHAT_AUTH_KEY=' + os.environ['GKEY'].strip(), s), encoding='utf-8')"
echo Ключ сохранён в .env на этом компьютере, в репозиторий он не попадёт.
:run
echo Открывайте http://localhost:8000  (панель: http://localhost:8000/admin)
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
goto :eof
:error
echo Не получилось установить зависимости. Нужен Python 3.11 или новее.
pause
