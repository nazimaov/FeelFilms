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

## 2) Run backend
```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

Health check:
- `http://127.0.0.1:8000/health`

## 3) Client endpoints
- `GET /api/movies?mood=all&page=1`
- `GET /api/movies/{film_id}`

## 4) Client configuration
- `main.py` reads backend URL from env `BACKEND_API_BASE` (default `http://127.0.0.1:8000`).
- `app.js` uses:
  - `window.FEELFILMS_BACKEND_API_BASE` (if set), else
  - `localStorage['feelfilms_backend_api_base']`, else
  - `http://127.0.0.1:8000` for `file://` mode.

For production, set a public backend URL (HTTPS) in one of those two client options.
