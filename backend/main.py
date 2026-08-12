"""Единая точка входа backend для Oracle Cloud.

Важно:
- Сервер приложения = Oracle Cloud (этот FastAPI backend)
- Источник фильмов = внешний Kinopoisk API

Этот файл намеренно реэкспортирует `app` из `backend/server.py`,
чтобы деплой через `backend.main:app` и `backend.server:app`
всегда поднимал один и тот же сервис.
"""

from __future__ import annotations

try:
    # Запуск как модуля пакета: python -m backend.main
    from backend.server import app  # type: ignore
except Exception:
    # Запуск из директории backend: uvicorn main:app
    from server import app  # type: ignore


if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
