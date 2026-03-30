import os
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

KINOPOISK_API_KEY = os.getenv("KINOPOISK_API_KEY", "").strip()
KINOPOISK_API_BASE = os.getenv("KINOPOISK_API_BASE", "https://kinopoiskapiunofficial.tech").rstrip("/")
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))
ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS_RAW.split(",") if origin.strip()]

MOOD_GENRES: Dict[str, Optional[int]] = {
    "all": None,
    "comedy": 13,
    "horror": 17,
    "action": 11,
}

CATEGORY_CONFIG: Dict[str, Dict[str, object]] = {
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

app = FastAPI(title="FeelFilms API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _require_api_key() -> None:
    if not KINOPOISK_API_KEY:
        raise HTTPException(status_code=500, detail="KINOPOISK_API_KEY is not configured on server")


def _kinopoisk_get(path: str, params: Optional[dict] = None) -> dict:
    _require_api_key()
    url = f"{KINOPOISK_API_BASE}{path}"
    headers = {
        "X-API-KEY": KINOPOISK_API_KEY,
        "Content-Type": "application/json",
    }
    try:
        response = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Kinopoisk request failed: {exc}") from exc

    if not response.ok:
        detail = response.text[:300] if response.text else response.reason
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json()


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


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/movies")
def get_movies(
    mood: str = Query("all"),
    categories: str = Query(""),
    content_type: str = Query("ALL"),
    page: int = Query(1, ge=1, le=50),
    limit: int = Query(40, ge=10, le=100),
) -> dict:
    selected_categories = _parse_categories(categories)
    mood_key = mood.lower().strip()

    # Backward compatibility with old mood-based frontend.
    if not selected_categories and mood_key and mood_key != "all":
        if mood_key not in MOOD_GENRES:
            raise HTTPException(status_code=400, detail="Unsupported mood")
        selected_categories = [mood_key]

    requested_type = content_type.upper().strip() if content_type else "ALL"
    if requested_type not in {"ALL", "FILM", "TV_SERIES"}:
        raise HTTPException(status_code=400, detail="Unsupported content_type")

    if not selected_categories or "all" in selected_categories:
        return _kinopoisk_get(
            "/api/v2.2/films/collections",
            params={"type": "TOP_POPULAR_ALL", "page": page},
        )

    responses: List[List[dict]] = []
    for category in selected_categories[:6]:
        cfg = CATEGORY_CONFIG.get(category)
        if not cfg:
            continue

        genre_id = cfg.get("genre_id")
        category_type = (cfg.get("type") or "ALL").upper()
        api_type = requested_type if requested_type != "ALL" else category_type
        if api_type not in {"ALL", "FILM", "TV_SERIES"}:
            api_type = "ALL"

        params = {"order": "NUM_VOTE", "type": api_type, "page": page}
        if genre_id:
            params["genres"] = int(genre_id)

        data = _kinopoisk_get("/api/v2.2/films", params=params)
        responses.append(_normalize_items(data))

    merged_items = _merge_ranked(responses, limit=limit)
    return {"items": merged_items, "total": len(merged_items)}


@app.get("/api/movies/{film_id}")
def get_movie_details(film_id: int) -> dict:
    return _kinopoisk_get(f"/api/v2.2/films/{film_id}")
