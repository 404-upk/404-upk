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
echo Открывайте http://localhost:8000  (панель: http://localhost:8000/admin)
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
goto :eof
:error
echo Не получилось установить зависимости. Нужен Python 3.11 или новее.
pause
