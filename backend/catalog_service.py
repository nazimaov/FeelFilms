"""Отдача ленты из локального каталога (``catalog.json``).

Заменяет живые запросы к Kinopoisk для эндпоинта ``/api/movies``: фильтрует и
пагинирует заранее собранный каталог (см. :mod:`catalog_builder`). Если каталога
нет — вызывающая сторона откатывается на живой источник (movie_service).

Формат ответа полностью совпадает с прежним, поэтому приложение менять не нужно.
Файл каталога перечитывается автоматически при изменении (ежедневная пересборка
подхватывается без перезапуска сервиса).
"""

from __future__ import annotations

import json
import logging
import random
import threading
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("feelfilms.catalog_service")

# Слаг категории из приложения -> название жанра в данных Kinopoisk.
CATEGORY_TO_GENRE: Dict[str, str] = {
    "comedy": "комедия",
    "horror": "ужасы",
    "action": "боевик",
    "thriller": "триллер",
    "detective": "детектив",
    "fantasy": "фэнтези",
    "drama": "драма",
    "romance": "мелодрама",
    "adventure": "приключения",
    "family": "семейный",
    "crime": "криминал",
    "mystic": "детектив",
    "anime": "аниме",
    "cartoon": "мультфильм",
    "documentary": "документальный",
    "history": "история",
    "psychological": "драма",
    "short": "короткометражка",
    "fantastic": "фантастика",
    "war": "военный",
    "western": "вестерн",
    "musical": "мюзикл",
    "sport": "спорт",
    "biography": "биография",
}

MOOD_TO_GENRE: Dict[str, Optional[str]] = {
    "all": None,
    "comedy": "комедия",
    "horror": "ужасы",
    "action": "боевик",
}


class CatalogService:
    def __init__(self, catalog_path: Path) -> None:
        self._path = Path(catalog_path)
        self._items: List[dict] = []
        self._mtime: Optional[float] = None
        self._lock = threading.Lock()
        self._load()

    # ------------------------------------------------------------------
    def _load(self) -> None:
        try:
            if not self._path.exists():
                self._items = []
                self._mtime = None
                logger.info("Каталог %s не найден — работа через живой источник.", self._path)
                return
            mtime = self._path.stat().st_mtime
            with self._path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            items = data.get("items") if isinstance(data, dict) else data
            if not isinstance(items, list):
                items = []
            # Стабильный порядок «по популярности» (по числу голосов).
            items.sort(key=lambda m: m.get("ratingVoteCount") or 0, reverse=True)
            self._items = items
            self._mtime = mtime
            logger.info("Каталог загружен: %d фильмов из %s", len(items), self._path)
        except Exception as exc:  # noqa: BLE001
            logger.error("Не удалось загрузить каталог %s: %s", self._path, exc)
            self._items = []
            self._mtime = None

    def _reload_if_changed(self) -> None:
        try:
            if not self._path.exists():
                if self._items:
                    with self._lock:
                        self._items = []
                        self._mtime = None
                return
            mtime = self._path.stat().st_mtime
            if mtime != self._mtime:
                with self._lock:
                    self._load()
        except OSError:
            pass

    @property
    def available(self) -> bool:
        self._reload_if_changed()
        return len(self._items) > 0

    @property
    def size(self) -> int:
        return len(self._items)

    # ------------------------------------------------------------------
    @staticmethod
    def _target_genres(categories: str, mood: str) -> List[str]:
        genres: List[str] = []
        for slug in (categories or "").split(","):
            slug = slug.strip().lower()
            if slug in CATEGORY_TO_GENRE:
                genres.append(CATEGORY_TO_GENRE[slug])
        mood_genre = MOOD_TO_GENRE.get((mood or "").strip().lower())
        if mood_genre:
            genres.append(mood_genre)
        return list(dict.fromkeys(genres))  # уникальные, сохраняя порядок

    @staticmethod
    def _movie_countries(movie: dict) -> set:
        """Названия стран фильма в нижнем регистре."""
        return {
            (c.get("country") or "").strip().lower()
            for c in (movie.get("countries") or [])
            if isinstance(c, dict)
        }

    @staticmethod
    def _movie_year(movie: dict):
        try:
            return int(str(movie.get("year"))[:4])
        except (TypeError, ValueError):
            return None

    def get_movies(
        self,
        *,
        mood: str,
        categories: str,
        content_type: str,
        page: int,
        limit: int,
        country: str = "",
        year: int = 0,
    ) -> dict:
        self._reload_if_changed()
        items = self._items

        requested_type = (content_type or "ALL").upper().strip()
        cats = [c.strip().lower() for c in (categories or "").split(",") if c.strip()]
        want_series = "series" in cats

        target_genres = self._target_genres(categories, mood)
        wanted_country = (country or "").strip().lower()
        wanted_year = year if isinstance(year, int) and year > 0 else 0

        def matches(movie: dict) -> bool:
            mtype = movie.get("type", "FILM")
            if want_series and mtype != "TV_SERIES":
                return False
            if requested_type in {"FILM", "TV_SERIES"} and mtype != requested_type:
                return False
            if target_genres:
                names = {
                    (g.get("genre") or "").lower()
                    for g in (movie.get("genres") or [])
                    if isinstance(g, dict)
                }
                if not any(t.lower() in names for t in target_genres):
                    return False
            # Страна и год отбираются здесь, по всему каталогу. Раньше это
            # делалось уже в приложении — по присланной странице, из-за чего
            # при узком выборе лента почти сразу заканчивалась.
            if wanted_country:
                countries = self._movie_countries(movie)
                if not any(
                    wanted_country in name or name in wanted_country
                    for name in countries
                    if name
                ):
                    return False
            if wanted_year:
                if self._movie_year(movie) != wanted_year:
                    return False
            return True

        filtered = [m for m in items if matches(m)]

        start = max(0, (page - 1) * limit)
        page_items = filtered[start:start + limit]

        return {
            "source": "catalog",
            "page": page,
            "limit": limit,
            "total": len(page_items),
            "catalog_total": len(filtered),
            "items": page_items,
        }

    def get_movie(self, film_id: int) -> Optional[dict]:
        self._reload_if_changed()
        for movie in self._items:
            if movie.get("kinopoiskId") == film_id:
                return movie
        return None

    @staticmethod
    def _norm_title(value: str) -> str:
        return (value or "").strip().lower().replace("ё", "е")

    def search(self, query: str, limit: int = 30) -> dict:
        """Поиск фильмов/сериалов по названию в локальном каталоге.

        Совпадение считается по nameRu/nameEn/nameOriginal. Ранжируем: точное
        совпадение > начинается с запроса > содержит запрос; при равенстве —
        по популярности (числу голосов). Формат items совпадает с get_movies.
        """
        self._reload_if_changed()
        qn = self._norm_title(query)
        if not qn:
            return {"source": "catalog", "query": query, "total": 0, "items": []}

        scored = []
        for movie in self._items:
            names = [
                self._norm_title(movie.get("nameRu")),
                self._norm_title(movie.get("nameEn")),
                self._norm_title(movie.get("nameOriginal")),
            ]
            best = 0
            for name in names:
                if not name:
                    continue
                if name == qn:
                    score = 3
                elif name.startswith(qn):
                    score = 2
                elif qn in name:
                    score = 1
                else:
                    continue
                if score > best:
                    best = score
            if best:
                scored.append((best, movie.get("ratingVoteCount") or 0, movie))

        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        items = [movie for _, _, movie in scored[:limit]]
        return {
            "source": "catalog",
            "query": query,
            "total": len(items),
            "items": items,
        }
