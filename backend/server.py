from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    from backend.kinopoisk_service import KinopoiskConfig, KinopoiskService, UpstreamServiceError
    from backend.catalog_service import CatalogService
except Exception:
    from kinopoisk_service import KinopoiskConfig, KinopoiskService, UpstreamServiceError
    from catalog_service import CatalogService

load_dotenv(encoding="utf-8-sig")

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
UPSTREAM_MAX_WORKERS_FALLBACK = 4
CONNECT_TIMEOUT_SECONDS_FALLBACK = 5.0

KINOPOISK_API_KEY = os.getenv("KINOPOISK_API_KEY", "").strip()
KINOPOISK_API_BASE = os.getenv("KINOPOISK_API_BASE", "https://kinopoiskapiunofficial.tech").rstrip("/")
ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*").strip()


def _parse_timeout(raw_value: str, fallback: float, name: str) -> float:
    try:
        timeout = float(raw_value)
        if timeout <= 0:
            raise ValueError("Timeout must be positive")
        return timeout
    except (TypeError, ValueError):
        logger.warning("Invalid %s='%s'. Falling back to %.1f", name, raw_value, fallback)
        return fallback


def _parse_positive_int(raw_value: str, fallback: int, name: str) -> int:
    try:
        parsed = int(raw_value)
        if parsed <= 0:
            raise ValueError("Value must be positive")
        return parsed
    except (TypeError, ValueError):
        logger.warning("Invalid %s='%s'. Falling back to %d", name, raw_value, fallback)
        return fallback


def _parse_allowed_origins(raw_value: str) -> list[str]:
    if raw_value == "*":
        return ["*"]
    values = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return values or ["*"]


REQUEST_TIMEOUT_SECONDS = _parse_timeout(
    os.getenv("REQUEST_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)),
    DEFAULT_TIMEOUT_SECONDS,
    "REQUEST_TIMEOUT_SECONDS",
)
CONNECT_TIMEOUT_SECONDS = _parse_timeout(
    os.getenv("CONNECT_TIMEOUT_SECONDS", str(CONNECT_TIMEOUT_SECONDS_FALLBACK)),
    CONNECT_TIMEOUT_SECONDS_FALLBACK,
    "CONNECT_TIMEOUT_SECONDS",
)
DEFAULT_PAGE = _parse_positive_int(
    os.getenv("DEFAULT_PAGE", str(DEFAULT_PAGE_FALLBACK)),
    DEFAULT_PAGE_FALLBACK,
    "DEFAULT_PAGE",
)
DEFAULT_LIMIT = _parse_positive_int(
    os.getenv("DEFAULT_LIMIT", str(DEFAULT_LIMIT_FALLBACK)),
    DEFAULT_LIMIT_FALLBACK,
    "DEFAULT_LIMIT",
)
MAX_PAGE = _parse_positive_int(
    os.getenv("MAX_PAGE", str(MAX_PAGE_FALLBACK)),
    MAX_PAGE_FALLBACK,
    "MAX_PAGE",
)
MAX_LIMIT = _parse_positive_int(
    os.getenv("MAX_LIMIT", str(MAX_LIMIT_FALLBACK)),
    MAX_LIMIT_FALLBACK,
    "MAX_LIMIT",
)
MAX_CATEGORY_FILTERS = _parse_positive_int(
    os.getenv("MAX_CATEGORY_FILTERS", str(MAX_CATEGORY_FILTERS_FALLBACK)),
    MAX_CATEGORY_FILTERS_FALLBACK,
    "MAX_CATEGORY_FILTERS",
)
UPSTREAM_MAX_WORKERS = _parse_positive_int(
    os.getenv("UPSTREAM_MAX_WORKERS", str(UPSTREAM_MAX_WORKERS_FALLBACK)),
    UPSTREAM_MAX_WORKERS_FALLBACK,
    "UPSTREAM_MAX_WORKERS",
)
ALLOWED_ORIGINS = _parse_allowed_origins(ALLOWED_ORIGINS_RAW)

if DEFAULT_PAGE > MAX_PAGE:
    logger.warning("DEFAULT_PAGE (%d) is greater than MAX_PAGE (%d). Adjusting DEFAULT_PAGE.", DEFAULT_PAGE, MAX_PAGE)
    DEFAULT_PAGE = MAX_PAGE
if DEFAULT_LIMIT > MAX_LIMIT:
    logger.warning("DEFAULT_LIMIT (%d) is greater than MAX_LIMIT (%d). Adjusting DEFAULT_LIMIT.", DEFAULT_LIMIT, MAX_LIMIT)
    DEFAULT_LIMIT = MAX_LIMIT

service_config = KinopoiskConfig(
    api_key=KINOPOISK_API_KEY,
    api_base=KINOPOISK_API_BASE,
    connect_timeout_seconds=CONNECT_TIMEOUT_SECONDS,
    read_timeout_seconds=REQUEST_TIMEOUT_SECONDS,
    default_page=DEFAULT_PAGE,
    default_limit=DEFAULT_LIMIT,
    max_page=MAX_PAGE,
    max_limit=MAX_LIMIT,
    max_category_filters=MAX_CATEGORY_FILTERS,
    upstream_max_workers=UPSTREAM_MAX_WORKERS,
)
movie_service = KinopoiskService(service_config)

# Локальный каталог: если собран (catalog.json), лента отдаётся из него, а не из
# живого Kinopoisk — пользователи не тратят лимит API. Иначе — работа по-старому.
CATALOG_PATH = Path(os.getenv("CATALOG_PATH", str(Path(__file__).parent / "catalog.json")))
catalog_service = CatalogService(CATALOG_PATH)

app = FastAPI(title="FeelFilms API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    logger.info("Starting FeelFilms API v3.0.0")
    logger.info(
        "Configuration: api_base=%s connect_timeout=%.1fs read_timeout=%.1fs default_page=%d default_limit=%d max_page=%d max_limit=%d max_category_filters=%d workers=%d origins=%s has_api_key=%s",
        KINOPOISK_API_BASE,
        CONNECT_TIMEOUT_SECONDS,
        REQUEST_TIMEOUT_SECONDS,
        DEFAULT_PAGE,
        DEFAULT_LIMIT,
        MAX_PAGE,
        MAX_LIMIT,
        MAX_CATEGORY_FILTERS,
        UPSTREAM_MAX_WORKERS,
        ALLOWED_ORIGINS,
        bool(KINOPOISK_API_KEY),
    )


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
        "version": "3.0.0",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
    }


DEFAULT_APP_CONFIG: dict = {
    "banner_enabled": True,
    "interstitial_enabled": True,
    "interstitial_every_n_opens": 8,
    "interstitial_every_n_swipes": 15,
    "interstitial_min_interval_seconds": 180,
    "interstitial_grace_period_seconds": 60,
    "banner_max_height_dp": 50,
    "announcement": {
        "enabled": False,
        "id": "",
        "title": "Вышла новая версия",
        "message": "Обновите FeelFilm в RuStore — там свежие функции и улучшения.",
        "action_text": "Обновить",
        "action_url": "https://www.rustore.ru/catalog/app/com.feelfilm.app",
        "dismissible": True,
    },
}

APP_CONFIG_PATH = Path(__file__).parent / "app_config.json"


@app.get("/api/config")
def get_config() -> dict:
    try:
        with open(APP_CONFIG_PATH, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        return {**DEFAULT_APP_CONFIG, **loaded}
    except FileNotFoundError:
        logger.warning("app_config.json not found, returning defaults")
        return DEFAULT_APP_CONFIG
    except Exception as exc:
        logger.warning("Failed to read app_config.json: %s", exc)
        return DEFAULT_APP_CONFIG


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "has_api_key": movie_service.has_api_key,
        "api_base": KINOPOISK_API_BASE,
        "connect_timeout_seconds": CONNECT_TIMEOUT_SECONDS,
        "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
        "catalog_available": catalog_service.available,
        "catalog_size": catalog_service.size,
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
    # Приоритет — локальный каталог (не тратит лимит Kinopoisk). Если каталог
    # не покрывает запрос (нет таких фильмов) — откат на живой источник.
    if catalog_service.available:
        try:
            result = catalog_service.get_movies(
                mood=mood,
                categories=categories,
                content_type=content_type,
                page=page,
                limit=limit,
            )
            if result.get("catalog_total", 0) > 0:
                return result
            logger.info("Каталог не покрыл запрос — откат на живой источник.")
        except Exception as exc:  # noqa: BLE001 — при сбое каталога не роняем ленту
            logger.warning("Ошибка отдачи из каталога, откат на живой источник: %s", exc)

    try:
        return movie_service.get_movies(
            mood=mood,
            categories=categories,
            content_type=content_type,
            page=page,
            limit=limit,
        )
    except UpstreamServiceError:
        raise
    except Exception as exc:
        logger.exception("Unexpected server error in /api/movies: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@app.get("/api/movies/{film_id}")
def get_movie_details(film_id: int) -> dict:
    logger.info("GET /api/movies/%s", film_id)
    try:
        return movie_service.get_movie_details(film_id)
    except UpstreamServiceError:
        raise
    except Exception as exc:
        logger.exception("Unexpected server error in /api/movies/%s: %s", film_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@app.get("/api/movies/{film_id}/similars")
def get_movie_similars(film_id: int) -> dict:
    logger.info("GET /api/movies/%s/similars", film_id)
    try:
        items = movie_service.get_similar_movies(film_id)
        return {"source": "kinopoisk", "total": len(items), "items": items}
    except UpstreamServiceError:
        raise
    except Exception as exc:
        logger.exception("Unexpected server error in /api/movies/%s/similars: %s", film_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@app.get("/api/movies/{film_id}/videos")
def get_movie_videos(film_id: int) -> dict:
    logger.info("GET /api/movies/%s/videos", film_id)
    try:
        items = movie_service.get_movie_videos(film_id)
        return {"source": "kinopoisk", "total": len(items), "items": items}
    except UpstreamServiceError:
        raise
    except Exception as exc:
        logger.exception("Unexpected server error in /api/movies/%s/videos: %s", film_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


class RecommendationsRequest(BaseModel):
    liked_ids: list[int] = Field(default_factory=list)
    top_genres: list[str] = Field(default_factory=list)
    blocked_genres: list[str] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=50)


@app.post("/api/recommendations")
def post_recommendations(payload: RecommendationsRequest) -> dict:
    logger.info(
        "POST /api/recommendations liked=%d top_genres=%s blocked_genres=%s limit=%d",
        len(payload.liked_ids),
        payload.top_genres,
        payload.blocked_genres,
        payload.limit,
    )
    try:
        return movie_service.get_recommendations(
            liked_ids=payload.liked_ids,
            top_genres=payload.top_genres,
            blocked_genres=payload.blocked_genres,
            limit=payload.limit,
        )
    except UpstreamServiceError:
        raise
    except Exception as exc:
        logger.exception("Unexpected server error in /api/recommendations: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
