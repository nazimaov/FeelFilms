from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from backend.kinopoisk_service import KinopoiskConfig, KinopoiskService, UpstreamServiceError
    from backend.catalog_service import CatalogService
    from backend.ai_service import build_ai_assistant
    from backend.overrides_service import OverridesService, ALLOWED_FIELDS
    from backend.admin_auth import require_admin
except Exception:
    from kinopoisk_service import KinopoiskConfig, KinopoiskService, UpstreamServiceError
    from catalog_service import CatalogService
    from ai_service import build_ai_assistant
    from overrides_service import OverridesService, ALLOWED_FIELDS
    from admin_auth import require_admin

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

# ИИ-ассистент поиска фильмов (провайдер задаётся окружением, по умолчанию Groq).
ai_assistant = build_ai_assistant()

# Ручные правки данных фильмов (админ-панель).
OVERRIDES_PATH = Path(os.getenv("OVERRIDES_PATH", str(Path(__file__).parent / "overrides.json")))
overrides_service = OverridesService(OVERRIDES_PATH)

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


# ------------------------------------------------------------------
# Админ-панель (статическая веб-страница). Открывается по /admin/.
# Доступ ограничен на клиенте: логин через Firebase Auth + whitelist email
# в admin.js. Роут просто отдаёт HTML/CSS/JS.
# ------------------------------------------------------------------
ADMIN_DIR = Path(os.getenv("ADMIN_DIR", str(Path(__file__).parent.parent / "admin")))
if ADMIN_DIR.exists():
    app.mount("/admin", StaticFiles(directory=str(ADMIN_DIR), html=True), name="admin")
    logger.info("Admin panel served from %s", ADMIN_DIR)
else:
    logger.warning("Admin panel directory not found: %s", ADMIN_DIR)


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
                result["items"] = overrides_service.apply_to_list(result.get("items", []))
                return result
            logger.info("Каталог не покрыл запрос — откат на живой источник.")
        except Exception as exc:  # noqa: BLE001 — при сбое каталога не роняем ленту
            logger.warning("Ошибка отдачи из каталога, откат на живой источник: %s", exc)

    try:
        response = movie_service.get_movies(
            mood=mood,
            categories=categories,
            content_type=content_type,
            page=page,
            limit=limit,
        )
        response["items"] = overrides_service.apply_to_list(response.get("items", []))
        return response
    except UpstreamServiceError:
        raise
    except Exception as exc:
        logger.exception("Unexpected server error in /api/movies: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@app.get("/api/search")
def search_movies(
    query: str = Query("", min_length=0),
    limit: int = Query(30, ge=1, le=50),
) -> dict:
    q = (query or "").strip()
    logger.info("GET /api/search query=%r limit=%s", q, limit)
    if len(q) < 2:
        return {"source": "catalog", "query": q, "total": 0, "items": []}

    # Сначала локальный каталог (мгновенно, без расхода лимита Kinopoisk).
    if catalog_service.available:
        try:
            result = catalog_service.search(q, limit=limit)
            if result.get("total", 0) > 0:
                result["items"] = overrides_service.apply_to_list(result.get("items", []))
                return result
        except Exception as exc:  # noqa: BLE001 — при сбое каталога пробуем живой источник
            logger.warning("Ошибка поиска по каталогу, откат на Kinopoisk: %s", exc)

    # Каталог не покрыл запрос — ищем через Kinopoisk (результат кэшируется).
    try:
        response = movie_service.search_movies(q, limit=limit)
        response["items"] = overrides_service.apply_to_list(response.get("items", []))
        return response
    except UpstreamServiceError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("Ошибка поиска через Kinopoisk: %s", exc)
        return {"source": "catalog", "query": q, "total": 0, "items": []}


@app.get("/api/movies/{film_id}")
def get_movie_details(film_id: int) -> dict:
    logger.info("GET /api/movies/%s", film_id)
    try:
        details = movie_service.get_movie_details(film_id)
        return overrides_service.apply_to_movie(details)
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
    # Ручная подмена трейлера (админка): если у фильма проставлен trailerUrl,
    # он полностью заменяет обычный ответ — сначала показываем override, всё
    # остальное игнорируем, чтобы гарантировать нужное видео.
    override_url = overrides_service.get_trailer_url(film_id)
    if override_url:
        site = "KINOPOISK_WIDGET" if "widgets.kinopoisk.ru" in override_url else (
            "RUTUBE" if "rutube.ru" in override_url else "OVERRIDE"
        )
        override_item = {
            "url": override_url,
            "name": overrides_service.get(film_id).get("trailerName") or "Трейлер",
            "site": site,
        }
        return {"source": "override", "total": 1, "items": [override_item]}
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


# ------------------------------------------------------------------
# ИИ-ассистент поиска фильмов
# ------------------------------------------------------------------

def _movie_year(movie: dict):
    try:
        return int(str(movie.get("year"))[:4])
    except (TypeError, ValueError):
        return None


def _norm_title(value: str) -> str:
    return re.sub(r"[^a-zа-я0-9 ]+", " ", (value or "").lower().replace("ё", "е")).strip()


def _title_matches(candidate: dict, wanted: str) -> bool:
    """Строгая проверка: одно из названий фильма реально совпадает с запросом
    ИИ (равно или начинается с него; не «случайно похоже по подстроке»)."""
    wn = _norm_title(wanted)
    if not wn:
        return False
    for name in (candidate.get("nameRu"), candidate.get("nameEn"), candidate.get("nameOriginal")):
        cn = _norm_title(name)
        if not cn:
            continue
        if cn == wn or cn.startswith(wn + " ") or wn.startswith(cn + " ") or cn == wn:
            return True
    return False


def _resolve_ai_movie(title: str, year) -> Optional[dict]:
    """Превращает предложенное ИИ название в реальную карточку FeelFilm.

    Ищет в локальном каталоге, затем в Kinopoisk. Возвращает совпадение ТОЛЬКО
    если название реально совпадает по одному из названий фильма и (при наличии
    года) год близок. «Случайно похожее по подстроке» отбрасывается — лучше
    ничего не показать, чем показать не тот фильм.
    """
    title = (title or "").strip()
    if not title:
        return None

    candidates: list = []
    if catalog_service.available:
        try:
            candidates = catalog_service.search(title, limit=8).get("items", [])
        except Exception:  # noqa: BLE001
            candidates = []
    if not candidates:
        try:
            candidates = movie_service.search_movies(title, limit=8).get("items", [])
        except Exception:  # noqa: BLE001
            candidates = []
    if not candidates:
        return None

    # Оставляем только те, чьё название реально совпадает с запросом ИИ.
    strict = [m for m in candidates if _title_matches(m, title)]
    if not strict:
        return None  # не подставляем «мусор ради количества»

    if isinstance(year, int):
        exact = [m for m in strict if _movie_year(m) == year]
        if exact:
            return exact[0]
        dated = [(abs(_movie_year(m) - year), m) for m in strict if _movie_year(m) is not None]
        if dated:
            dated.sort(key=lambda pair: pair[0])
            if dated[0][0] <= 2:  # в пределах пары лет — считаем тем же фильмом
                return dated[0][1]
    return strict[0]


class AIMessage(BaseModel):
    role: str = Field(default="user")
    content: str = Field(default="")


class AIAssistantRequest(BaseModel):
    messages: list[AIMessage] = Field(default_factory=list)


@app.post("/api/ai/assistant")
def post_ai_assistant(payload: AIAssistantRequest) -> dict:
    logger.info("POST /api/ai/assistant messages=%d", len(payload.messages))
    if not ai_assistant.enabled:
        return {
            "enabled": False,
            "reply": "ИИ-ассистент пока не настроен.",
            "need_more_info": False,
            "movies": [],
        }

    history = [{"role": m.role, "content": m.content} for m in payload.messages]
    try:
        result = ai_assistant.assist(history)
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI assistant error: %s", exc)
        result = None

    if not result:
        return {
            "enabled": True,
            "reply": "Не удалось обработать запрос. Попробуйте описать фильм подробнее.",
            "need_more_info": False,
            "movies": [],
        }

    resolved: list = []
    seen_ids: set = set()
    for suggestion in result.get("movies", []):
        movie = _resolve_ai_movie(suggestion.get("title"), suggestion.get("year"))
        if not movie:
            continue
        mid = movie.get("kinopoiskId") or movie.get("filmId")
        if mid in seen_ids:
            continue
        seen_ids.add(mid)
        resolved.append(movie)

    reply = result.get("reply", "")
    if not resolved and not result.get("need_more_info") and not reply:
        reply = "Ничего похожего не нашёл. Попробуйте вспомнить ещё детали."

    return {
        "enabled": True,
        "reply": reply,
        "need_more_info": result.get("need_more_info", False),
        "movies": resolved,
    }


# ------------------------------------------------------------------
# Админ-панель: редактирование фильмов (overrides) + история
# ------------------------------------------------------------------

from fastapi import Depends


class AdminMovieUpdate(BaseModel):
    fields: dict = Field(default_factory=dict)


def _get_movie_snapshot(film_id: int) -> Optional[dict]:
    """Достаёт «сырой» фильм: сначала из каталога, потом из Kinopoisk."""
    if catalog_service.available:
        movie = catalog_service.get_movie(film_id)
        if movie:
            return movie
    try:
        return movie_service.get_movie_details(film_id)
    except UpstreamServiceError:
        return None
    except Exception:
        return None


@app.get("/api/admin/movie/{film_id}")
def admin_get_movie(film_id: int, admin: str = Depends(require_admin)) -> dict:
    logger.info("ADMIN %s GET /api/admin/movie/%s", admin, film_id)
    original = _get_movie_snapshot(film_id) or {"kinopoiskId": film_id}
    override = overrides_service.get(film_id)
    trailer_override = overrides_service.get_trailer_url(film_id)
    return {
        "movieId": film_id,
        "original": original,
        "override": override,
        "trailerOverride": trailer_override,
        "allowedFields": sorted(ALLOWED_FIELDS),
    }


@app.put("/api/admin/movie/{film_id}")
def admin_update_movie(film_id: int, payload: AdminMovieUpdate,
                       admin: str = Depends(require_admin)) -> dict:
    logger.info("ADMIN %s PUT /api/admin/movie/%s fields=%s", admin, film_id, list(payload.fields.keys()))
    snapshot = _get_movie_snapshot(film_id)
    new_state = overrides_service.update(
        film_id, payload.fields, admin_email=admin, snapshot=snapshot
    )
    return {"movieId": film_id, "override": new_state}


@app.delete("/api/admin/movie/{film_id}/overrides")
def admin_clear_overrides(film_id: int, admin: str = Depends(require_admin)) -> dict:
    logger.info("ADMIN %s DELETE overrides for %s", admin, film_id)
    overrides_service.clear(film_id, admin_email=admin)
    return {"movieId": film_id, "override": {}}


@app.get("/api/admin/movie/{film_id}/history")
def admin_movie_history(film_id: int, admin: str = Depends(require_admin)) -> dict:
    items = overrides_service.history_for(film_id, limit=50)
    return {"movieId": film_id, "total": len(items), "items": items}


class AdminRevertRequest(BaseModel):
    versionId: str


@app.post("/api/admin/movie/{film_id}/revert")
def admin_revert(film_id: int, payload: AdminRevertRequest,
                 admin: str = Depends(require_admin)) -> dict:
    logger.info("ADMIN %s revert %s -> %s", admin, film_id, payload.versionId)
    state = overrides_service.revert_to(film_id, payload.versionId, admin_email=admin)
    if state is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"movieId": film_id, "override": state}


@app.get("/api/admin/overrides")
def admin_list_overrides(admin: str = Depends(require_admin)) -> dict:
    data = overrides_service.all()
    return {"total": len(data), "items": data}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
