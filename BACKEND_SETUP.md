# FeelFilms Backend Setup

## Why this is needed
- Firebase `apiKey` can be in client code.
- Kinopoisk API key must stay on server only.
- Clients (`app.js`, `main.py`) now call backend endpoints instead of Kinopoisk directly.

## 1) Prepare environment
```powershell
cd "c:\Users\Home\Documents\AI PROJECT\FeelFilms"
.\.venv\Scripts\python.exe -m pip install -r requirements-backend.txt
Copy-Item .env.example .env
```

Edit `.env` and set:
- `KINOPOISK_API_KEY=<your_real_key>`
- `ALLOWED_ORIGINS=<your frontend origin, or * for dev>`

### Трейлеры через RuTube (вместо YouTube)
YouTube в приложении отключён (в РФ недоступен). Трейлеры проигрываются из
виджета Kinopoisk (рус. дубляж), а где его нет — ищутся в **RuTube** через
открытый поиск (`https://rutube.ru/api/search/video/`) и отдаются встраиваемым
плеером `https://rutube.ru/play/embed/{id}`. Токен НЕ нужен, работает в России.

Настройки (все необязательные):
- `ENABLE_RUTUBE_SEARCH=1` — включён по умолчанию (`0` — выключить).
- `RUTUBE_TRAILER_CACHE_PATH=/opt/feelfilms/backend/rutube_trailer_cache.json`
  — путь к файлу-кэшу найденных трейлеров RuTube.

Логика в `get_movie_videos`: YouTube-ролики отбрасываются; если есть
встраиваемый виджет Kinopoisk — используется он; иначе ищется трейлер в RuTube
(с фильтром по длительности 20–420 сек, чтобы не подцепить полный фильм).

## 2) Run backend
```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Для Oracle Cloud используйте тот же entrypoint: `backend.main:app`.
`backend.main:app` и `backend.server:app` теперь поднимают один и тот же API.

Health check:
- `http://127.0.0.1:8000/health`

## 3) Client endpoints
- `GET /api/movies?mood=all&page=1`
- `GET /api/movies/{film_id}`

Архитектура:
- Клиент (Android/WebView) -> ваш backend на Oracle Cloud
- Backend (Oracle) -> Kinopoisk API (внешний источник фильмов)
- Клиент НЕ ходит в Kinopoisk API напрямую

## 4) Client configuration
- `main.py` reads backend URL from env `BACKEND_API_BASE` (default `http://127.0.0.1:8000`).
- `app.js` uses:
  - `window.FEELFILMS_BACKEND_API_BASE` (if set), else
  - `http://141.148.72.74:8000`.

For production, set a public backend URL (HTTPS) in one of those two client options.
