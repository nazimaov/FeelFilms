import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Do not commit `.env` to GitHub. Set secrets via environment variables (e.g., Render dashboard).
load_dotenv()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("feelfilms.backend")

DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_PAGE_FALLBACK = 1
DEFAULT_LIMIT_FALLBACK = 40
MAX_PAGE_FALLBACK = 50
MAX_LIMIT_FALLBACK = 100
MAX_CATEGORY_FILTERS_FALLBACK = 6
CACHE_TTL_SECONDS_FALLBACK = 120
UPSTREAM_MAX_WORKERS_FALLBACK = 4
CONNECT_TIMEOUT_SECONDS_FALLBACK = 5.0
KINOPOISK_API_KEY = os.getenv("KINOPOISK_API_KEY", "").strip()
KINOPOISK_API_BASE = os.getenv("KINOPOISK_API_BASE", "https://kinopoiskapiunofficial.tech").rstrip("/")
ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*").strip()


def _parse_timeout(raw_value: str) -> float:
    try:
        timeout = float(raw_value)
        if timeout <= 0:
            raise ValueError("Timeout must be positive")
        return timeout
    except (TypeError, ValueError):
        logger.warning(
            "Invalid REQUEST_TIMEOUT_SECONDS='%s'. Falling back to %.1f",
            raw_value,
            DEFAULT_TIMEOUT_SECONDS,
        )
        return DEFAULT_TIMEOUT_SECONDS


def _parse_positive_int(raw_value: str, fallback: int, name: str) -> int:
    try:
        parsed = int(raw_value)
        if parsed <= 0:
            raise ValueError("Value must be positive")
        return parsed
    except (TypeError, ValueError):
        logger.warning("Invalid %s='%s'. Falling back to %d", name, raw_value, fallback)
        return fallback


def _parse_allowed_origins(raw_value: str) -> List[str]:
    if raw_value == "*":
        return ["*"]
    values = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return values or ["*"]


REQUEST_TIMEOUT_SECONDS = _parse_timeout(os.getenv("REQUEST_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
CONNECT_TIMEOUT_SECONDS = _parse_timeout(
    os.getenv("CONNECT_TIMEOUT_SECONDS", str(CONNECT_TIMEOUT_SECONDS_FALLBACK))
)
ALLOWED_ORIGINS = _parse_allowed_origins(ALLOWED_ORIGINS_RAW)
DEFAULT_PAGE = _parse_positive_int(os.getenv("DEFAULT_PAGE", str(DEFAULT_PAGE_FALLBACK)), DEFAULT_PAGE_FALLBACK, "DEFAULT_PAGE")
DEFAULT_LIMIT = _parse_positive_int(
    os.getenv("DEFAULT_LIMIT", str(DEFAULT_LIMIT_FALLBACK)),
    DEFAULT_LIMIT_FALLBACK,
    "DEFAULT_LIMIT",
)
MAX_PAGE = _parse_positive_int(os.getenv("MAX_PAGE", str(MAX_PAGE_FALLBACK)), MAX_PAGE_FALLBACK, "MAX_PAGE")
MAX_LIMIT = _parse_positive_int(os.getenv("MAX_LIMIT", str(MAX_LIMIT_FALLBACK)), MAX_LIMIT_FALLBACK, "MAX_LIMIT")
MAX_CATEGORY_FILTERS = _parse_positive_int(
    os.getenv("MAX_CATEGORY_FILTERS", str(MAX_CATEGORY_FILTERS_FALLBACK)),
    MAX_CATEGORY_FILTERS_FALLBACK,
    "MAX_CATEGORY_FILTERS",
)
CACHE_TTL_SECONDS = _parse_positive_int(
    os.getenv("CACHE_TTL_SECONDS", str(CACHE_TTL_SECONDS_FALLBACK)),
    CACHE_TTL_SECONDS_FALLBACK,
    "CACHE_TTL_SECONDS",
)
UPSTREAM_MAX_WORKERS = _parse_positive_int(
    os.getenv("UPSTREAM_MAX_WORKERS", str(UPSTREAM_MAX_WORKERS_FALLBACK)),
    UPSTREAM_MAX_WORKERS_FALLBACK,
    "UPSTREAM_MAX_WORKERS",
)

if DEFAULT_PAGE > MAX_PAGE:
    logger.warning("DEFAULT_PAGE (%d) is greater than MAX_PAGE (%d). Adjusting DEFAULT_PAGE.", DEFAULT_PAGE, MAX_PAGE)
    DEFAULT_PAGE = MAX_PAGE
if DEFAULT_LIMIT > MAX_LIMIT:
    logger.warning("DEFAULT_LIMIT (%d) is greater than MAX_LIMIT (%d). Adjusting DEFAULT_LIMIT.", DEFAULT_LIMIT, MAX_LIMIT)
    DEFAULT_LIMIT = MAX_LIMIT

MOOD_GENRES: Dict[str, Optional[int]] = {
    "all": None,
    "comedy": 13,
    "horror": 17,
    "action": 11,
}

CATEGORY_CONFIG: Dict[str, Dict[str, Any]] = {
    "comedy": {"genre_id": 13, "type": "FILM"},
    "horror": {"genre_id": 17, "type": "FILM"},
    "action": {"genre_id": 11, "type": "FILM"},
    "thriller": {"genre_id": 1, "type": "FILM"},
    "detective": {"genre_id": 5, "type": "FILM"},
    "fantasy": {"genre_id": 6, "type": "FILM"},
    "drama": {"genre_id": 2, "type": "FILM"},
    "romance": {"genre_id": 4, "type": "FILM"},
    "adventure": {"genre_id": 7, "type": "FILM"},
    "family": {"genre_id": 19, "type": "FILM"},
    "crime": {"genre_id": 3, "type": "FILM"},
    "mystic": {"genre_id": 15, "type": "FILM"},
    "anime": {"genre_id": 24, "type": "FILM"},
    "cartoon": {"genre_id": 18, "type": "FILM"},
    "documentary": {"genre_id": 22, "type": "FILM"},
    "history": {"genre_id": 23, "type": "FILM"},
    "psychological": {"genre_id": 2, "type": "FILM"},
    "series": {"genre_id": None, "type": "TV_SERIES"},
    "short": {"genre_id": 23, "type": "FILM"},
}

app = FastAPI(title="FeelFilms API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

_session = requests.Session()
_session_adapter = HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=0)
_session.mount("https://", _session_adapter)
_session.mount("http://", _session_adapter)

_cache_lock = threading.Lock()
_response_cache: Dict[str, tuple[float, dict]] = {}


class UpstreamServiceError(Exception):
    def __init__(self, status_code: int, public_message: str) -> None:
        self.status_code = status_code
        self.public_message = public_message
        super().__init__(public_message)


@app.on_event("startup")
def on_startup() -> None:
    logger.info("Starting FeelFilms API v2.0.0")
    logger.info(
        "Configuration: api_base=%s connect_timeout=%.1fs read_timeout=%.1fs default_page=%d default_limit=%d max_page=%d max_limit=%d max_category_filters=%d cache_ttl=%ss workers=%d origins=%s has_api_key=%s",
        KINOPOISK_API_BASE,
        CONNECT_TIMEOUT_SECONDS,
        REQUEST_TIMEOUT_SECONDS,
        DEFAULT_PAGE,
        DEFAULT_LIMIT,
        MAX_PAGE,
        MAX_LIMIT,
        MAX_CATEGORY_FILTERS,
        CACHE_TTL_SECONDS,
        UPSTREAM_MAX_WORKERS,
        ALLOWED_ORIGINS,
        bool(KINOPOISK_API_KEY),
    )
    if not KINOPOISK_API_KEY:
        logger.warning("KINOPOISK_API_KEY is not set. API movie endpoints will return provider unavailable.")


def _build_cache_key(path: str, params: Optional[dict]) -> str:
    if not params:
        return path
    canonical = "&".join(f"{k}={params[k]}" for k in sorted(params))
    return f"{path}?{canonical}"


def _cache_get(key: str) -> Optional[dict]:
    now = time.time()
    with _cache_lock:
        item = _response_cache.get(key)
        if not item:
            return None
        expires_at, payload = item
        if expires_at <= now:
            _response_cache.pop(key, None)
            return None
        return payload


def _cache_set(key: str, payload: dict) -> None:
    expires_at = time.time() + CACHE_TTL_SECONDS
    with _cache_lock:
        _response_cache[key] = (expires_at, payload)


def _require_api_key() -> None:
    if not KINOPOISK_API_KEY:
        logger.error("KINOPOISK_API_KEY is missing")
        raise HTTPException(
            status_code=503,
            detail="Movie provider is temporarily unavailable",
        )


def _kinopoisk_get(path: str, params: Optional[dict] = None) -> dict:
    _require_api_key()
    cache_key = _build_cache_key(path, params)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    url = f"{KINOPOISK_API_BASE}{path}"
    headers = {"X-API-KEY": KINOPOISK_API_KEY, "Content-Type": "application/json"}

    try:
        response = _session.get(
            url,
            headers=headers,
            params=params,
            timeout=(CONNECT_TIMEOUT_SECONDS, REQUEST_TIMEOUT_SECONDS),
        )
    except requests.Timeout as exc:
        logger.warning("Kinopoisk timeout: path=%s params=%s", path, params)
        raise UpstreamServiceError(status_code=504, public_message="Movie provider timeout") from exc
    except requests.RequestException as exc:
        logger.warning("Kinopoisk request error: path=%s params=%s error=%s", path, params, exc)
        raise UpstreamServiceError(status_code=502, public_message=f"Movie provider is unavailable: {exc}") from exc

    if response.status_code == 404:
        raise UpstreamServiceError(status_code=404, public_message="Movie not found")

    if response.status_code in {401, 403}:
        logger.error("Kinopoisk authentication failed (status=%s)", response.status_code)
        raise UpstreamServiceError(status_code=502, public_message="Movie provider authentication failed")

    if not response.ok:
        logger.warning(
            "Kinopoisk returned non-OK response: status=%s path=%s params=%s",
            response.status_code,
            path,
            params,
        )
        raise UpstreamServiceError(
            status_code=502,
            public_message=f"Movie provider returned an error (status={response.status_code})",
        )

    try:
        payload = response.json()
        _cache_set(cache_key, payload)
        return payload
    except ValueError as exc:
        logger.warning("Kinopoisk returned invalid JSON: path=%s", path)
        raise UpstreamServiceError(status_code=502, public_message="Invalid response from movie provider") from exc


def _parse_categories(raw_categories: str) -> List[str]:
    if not raw_categories:
        return []
    values = [item.strip().lower() for item in raw_categories.split(",") if item.strip()]
    return [value for value in values if value == "all" or value in CATEGORY_CONFIG]


def _normalize_items(data: dict) -> List[dict]:
    return data.get("items") or data.get("films") or []


def _build_score(item: dict) -> float:
    rating = item.get("ratingKinopoisk") or item.get("rating") or 0
    try:
        rating_val = float(rating)
    except (TypeError, ValueError):
        rating_val = 0.0

    votes = item.get("ratingVoteCount") or item.get("ratingVoteCountKp") or 0
    try:
        votes_val = float(votes)
    except (TypeError, ValueError):
        votes_val = 0.0

    return rating_val * 10 + min(votes_val / 1000.0, 10.0)


def _merge_ranked(results: List[List[dict]], limit: int) -> List[dict]:
    merged: Dict[int, dict] = {}
    for result in results:
        for item in result:
            film_id = item.get("kinopoiskId") or item.get("filmId")
            if not film_id:
                continue
            if film_id not in merged:
                merged[film_id] = item
    ranked = sorted(merged.values(), key=_build_score, reverse=True)
    return ranked[:limit]


def _resolve_api_type(requested_type: str, category_type: str) -> str:
    api_type = requested_type if requested_type != "ALL" else category_type
    return api_type if api_type in {"ALL", "FILM", "TV_SERIES"} else "ALL"


def _fetch_category_movies(category: str, requested_type: str, page: int) -> List[dict]:
    cfg = CATEGORY_CONFIG.get(category)
    if not cfg:
        return []

    genre_id = cfg.get("genre_id")
    category_type = str(cfg.get("type") or "ALL").upper()
    api_type = _resolve_api_type(requested_type=requested_type, category_type=category_type)

    params: Dict[str, Any] = {"order": "NUM_VOTE", "type": api_type, "page": page}
    if genre_id:
        params["genres"] = int(genre_id)

    data = _kinopoisk_get("/api/v2.2/films", params=params)
    return _normalize_items(data)


@app.exception_handler(UpstreamServiceError)
async def upstream_exception_handler(request: Request, exc: UpstreamServiceError):
    logger.warning(
        "Upstream service error on %s %s: status=%s detail=%s",
        request.method,
        request.url.path,
        exc.status_code,
        exc.public_message,
    )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.public_message})


@app.get("/")
def root() -> dict:
    return {
        "name": "FeelFilms API",
        "version": "2.0.0",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "has_api_key": bool(KINOPOISK_API_KEY),
        "api_base": KINOPOISK_API_BASE,
        "connect_timeout_seconds": CONNECT_TIMEOUT_SECONDS,
        "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "upstream_max_workers": UPSTREAM_MAX_WORKERS,
    }


@app.get("/api/movies")
def get_movies(
    mood: str = Query("all"),
    categories: str = Query(""),
    content_type: str = Query("ALL"),
    page: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict:
    logger.info(
        "GET /api/movies mood=%s categories=%s content_type=%s page=%s limit=%s",
        mood,
        categories,
        content_type,
        page,
        limit,
    )
    selected_categories = _parse_categories(categories)
    mood_key = mood.lower().strip()

    if not selected_categories and mood_key and mood_key != "all":
        if mood_key not in MOOD_GENRES:
            raise HTTPException(status_code=400, detail="Unsupported mood")
        selected_categories = [mood_key]

    requested_type = content_type.upper().strip() if content_type else "ALL"
    if requested_type not in {"ALL", "FILM", "TV_SERIES"}:
        raise HTTPException(status_code=400, detail="Unsupported content_type")

    if not selected_categories or "all" in selected_categories:
        data = _kinopoisk_get(
            "/api/v2.2/films/collections",
            params={"type": "TOP_POPULAR_ALL", "page": page},
        )
        items = _normalize_items(data)[:limit]
        return {
            "source": "kinopoisk",
            "page": page,
            "limit": limit,
            "total": len(items),
            "items": items,
        }

    responses: List[List[dict]] = []
    categories_to_fetch = selected_categories[:MAX_CATEGORY_FILTERS]
    workers = min(UPSTREAM_MAX_WORKERS, max(1, len(categories_to_fetch)))

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_category = {
            executor.submit(_fetch_category_movies, category, requested_type, page): category
            for category in categories_to_fetch
        }
        for future in as_completed(future_to_category):
            category = future_to_category[future]
            try:
                category_items = future.result()
                if category_items:
                    responses.append(category_items)
            except UpstreamServiceError as exc:
                logger.warning("Skipping category '%s' due to upstream error: %s", category, exc.public_message)
            except Exception as exc:
                logger.exception("Unexpected error while fetching category '%s': %s", category, exc)

    if not responses:
        raise HTTPException(status_code=502, detail="Unable to fetch movies from movie provider")

    merged_items = _merge_ranked(responses, limit=limit)
    return {
        "source": "kinopoisk",
        "page": page,
        "limit": limit,
        "total": len(merged_items),
        "items": merged_items,
    }


@app.get("/api/movies/{film_id}")
def get_movie_details(film_id: int) -> dict:
    logger.info("GET /api/movies/%s", film_id)
    return _kinopoisk_get(f"/api/v2.2/films/{film_id}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
