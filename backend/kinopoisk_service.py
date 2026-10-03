from __future__ import annotations

import copy
import html
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger("feelfilms.kinopoisk")

# Полный фильм на RuTube — не короче 50 минут (серии сериалов короче).
MOVIE_MIN_DURATION_SECONDS = 50 * 60
RUTUBE_SERIES_MARKERS = re.compile(r"сезон|серия|серии|эпизод|\bs\d{1,2}e\d{1,3}\b", re.IGNORECASE)
# Результаты поиска RuTube кэшируем, чтобы не дергать его на каждое открытие карточки.
RUTUBE_SEARCH_TTL_SECONDS = 6 * 3600
_rutube_search_cache: Dict[tuple, tuple] = {}
_rutube_search_cache_lock = threading.Lock()


def _normalize_title(text: str) -> str:
    text = text.lower().replace("ё", "е")
    return " ".join(re.sub(r"[^0-9a-zа-я]+", " ", text).split())


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


MAILRU_SEARCH_URL = "https://my.mail.ru/video/search"
_MAILRU_ITEM_RE = re.compile(r'<div class="sp-video__video-list__item ">(.*?)(?=<div class="sp-video__video-list__item |\Z)', re.S)
_MAILRU_HREF_RE = re.compile(r'href="/mail/([^/"]+)/video/(?:[^"]*/)?(\d+)\.html"')
_MAILRU_DURATION_RE = re.compile(r'sp-video__video-list__duration">([\d:]+)<')
_MAILRU_TITLE_RE = re.compile(r'sp-video__video-list__name__text"[^>]*>(.*?)</p>', re.S)
_MAILRU_VIEWS_RE = re.compile(r'sp-video-icon-view-gray">([^<]+)<')
_MAILRU_DATE_RE = re.compile(r'sp-video__video-list__time">[^<]*?\d{2}\.\d{2}\.(\d{4})')
_MAILRU_THUMB_RE = re.compile(r"background-image: url\('([^']+)'\)")
_TAG_RE = re.compile(r"<[^>]+>")


def _parse_clock(text: str) -> int:
    """'2:03:53' или '45:10' -> секунды."""
    seconds = 0
    for part in text.split(":"):
        seconds = seconds * 60 + int(part)
    return seconds


def _parse_views(text: str) -> int:
    """'37.5K' -> 37500 (Mail.ru показывает сокращённо)."""
    raw = html.unescape(text).replace(" ", "").replace(" ", "").upper()
    multiplier = 1
    if raw.endswith("K"):
        multiplier, raw = 1000, raw[:-1]
    elif raw.endswith("M"):
        multiplier, raw = 1_000_000, raw[:-1]
    try:
        return int(float(raw.replace(",", ".")) * multiplier)
    except ValueError:
        return 0


# Ролик показываем, если набрал не меньше этого балла (из 100). Год каталога
# может отличаться от года в названии ролика, поэтому порог ниже 60.
WATCH_MIN_SCORE = 50
_FULL_MOVIE_MARKERS = re.compile(r"full\s*movie|full\s*film|полн\w*\s+фильм|полная\s+версия", re.IGNORECASE)


def _score_candidate(item: dict, runtime_minutes: Optional[int]) -> int:
    """Балл соответствия ролика фильму: название 40, год 25, длительность 25, тип 10.

    Длительность не отбрасывает ролик, а только добавляет баллы при совпадении.
    """
    score = 40  # название уже проверено фильтром _is_full_film_candidate
    if item["yearMatch"]:
        score += 25
    if runtime_minutes:
        # Длительность из каталога может не совпадать с версией на сайте, поэтому
        # она только добавляет баллы и никогда не отбрасывает ролик.
        diff = abs(item["duration"] / 60 - runtime_minutes)
        if diff <= 5:
            score += 25
        elif diff <= 15:
            score += 15
        elif diff <= 20:
            score += 5
    else:
        # Длительность фильма неизвестна: не штрафуем. Без этого 20 баллов ролик
        # с совпавшим названием не проходил порог, если год тоже не совпал.
        score += 20
    if _FULL_MOVIE_MARKERS.search(item["title"]):
        score += 10
    return score


def _is_full_film_candidate(title: str, duration: int, wanted_compact: str) -> bool:
    """Полный фильм: не короче 50 минут, не серия, название фильма есть в заголовке."""
    if duration < MOVIE_MIN_DURATION_SECONDS:
        return False
    if RUTUBE_SERIES_MARKERS.search(title):
        return False
    return wanted_compact in _normalize_title(title).replace(" ", "")


class UpstreamServiceError(Exception):
    def __init__(self, status_code: int, public_message: str) -> None:
        self.status_code = status_code
        self.public_message = public_message
        super().__init__(public_message)


@dataclass(frozen=True)
class KinopoiskConfig:
    api_key: str
    api_base: str
    connect_timeout_seconds: float
    read_timeout_seconds: float
    default_page: int
    default_limit: int
    max_page: int
    max_limit: int
    max_category_filters: int
    upstream_max_workers: int


class KinopoiskService:
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

    def __init__(self, config: KinopoiskConfig) -> None:
        self.config = config
        self._session = requests.Session()
        adapter = HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=0)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

        self._yt_search_enabled = os.getenv("ENABLE_YOUTUBE_SEARCH", "1").strip() not in {"0", "false", "False", ""}
        self._yt_cache_path = Path(os.getenv("YOUTUBE_CACHE_PATH", "/opt/feelfilms/backend/youtube_trailer_cache.json"))
        self._yt_cache_lock = threading.Lock()
        self._yt_cache: Dict[str, dict] = self._load_youtube_cache()
        self._yt_ydl = None  # lazy init

        # RuTube: замена YouTube (YouTube в РФ недоступен). Ищем трейлер через
        # открытый поиск RuTube (без токена) и отдаём встраиваемый плеер
        # https://rutube.ru/play/embed/{id}. Работает в России, играет в приложении.
        self._rutube_search_enabled = os.getenv("ENABLE_RUTUBE_SEARCH", "1").strip() not in {"0", "false", "False", ""}
        self._rutube_cache_path = Path(os.getenv("RUTUBE_TRAILER_CACHE_PATH", "/opt/feelfilms/backend/rutube_trailer_cache.json"))
        self._rutube_cache_lock = threading.Lock()
        self._rutube_cache: Dict[str, dict] = self._load_rutube_cache()

        # Кэш ответов Kinopoisk. Ключ Kinopoisk один на всех пользователей, а у
        # бесплатного тарифа суточный лимит запросов. Кэш отдаёт одинаковые
        # данные из памяти, резко снижая число обращений к Kinopoisk и ошибки
        # «сервер временно недоступен» при упоре в лимит.
        self._cache_enabled = os.getenv("KP_CACHE_ENABLED", "1").strip() not in {"0", "false", "False", ""}
        self._cache_ttl_lists = _env_float("KP_CACHE_TTL_LISTS", 3 * 3600.0)        # списки/коллекции — 3 ч
        self._cache_ttl_details = _env_float("KP_CACHE_TTL_DETAILS", 24 * 3600.0)    # детали/видео/похожие — 24 ч
        self._cache_ttl_premieres = _env_float("KP_CACHE_TTL_PREMIERES", 12 * 3600.0)  # премьеры — 12 ч
        self._cache_max_entries = int(_env_float("KP_CACHE_MAX_ENTRIES", 5000.0))
        self._cache: Dict[str, tuple] = {}
        self._cache_lock = threading.Lock()

    @property
    def has_api_key(self) -> bool:
        return bool(self.config.api_key)

    def _require_api_key(self) -> None:
        if not self.config.api_key:
            raise UpstreamServiceError(
                status_code=503,
                public_message="Movie provider is temporarily unavailable",
            )

    # ------------------------------------------------------------------
    # Кэш ответов Kinopoisk
    # ------------------------------------------------------------------
    def _cache_ttl(self, path: str) -> float:
        """Срок жизни кэша в секундах в зависимости от типа запроса (0 = не кэшировать)."""
        if not self._cache_enabled:
            return 0.0
        if path.endswith("/videos") or path.endswith("/similars"):
            return self._cache_ttl_details
        # Детали конкретного фильма: /api/v2.2/films/{id}
        if re.match(r"^/api/v2\.\d+/films/\d+$", path):
            return self._cache_ttl_details
        if "/premieres" in path:
            return self._cache_ttl_premieres
        # Списки, коллекции, фильтры.
        return self._cache_ttl_lists

    def _cache_get(self, key: str):
        now = time.time()
        with self._cache_lock:
            entry = self._cache.get(key)
            if not entry:
                return None
            expiry, data = entry
            if now >= expiry:
                self._cache.pop(key, None)
                return None
            return copy.deepcopy(data)

    def _cache_set(self, key: str, data: dict, ttl: float) -> None:
        with self._cache_lock:
            # Лёгкая уборка, чтобы память не росла бесконечно.
            if len(self._cache) >= self._cache_max_entries:
                now = time.time()
                for k in [k for k, (exp, _) in self._cache.items() if now >= exp]:
                    self._cache.pop(k, None)
                while len(self._cache) >= self._cache_max_entries:
                    self._cache.pop(next(iter(self._cache)), None)
            self._cache[key] = (time.time() + ttl, copy.deepcopy(data))

    def _kinopoisk_get(self, path: str, params: Optional[dict] = None) -> dict:
        self._require_api_key()

        ttl = self._cache_ttl(path)
        cache_key = None
        if ttl > 0:
            cache_key = f"{path}|{json.dumps(params or {}, sort_keys=True, ensure_ascii=False)}"
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        url = f"{self.config.api_base}{path}"
        headers = {
            "X-API-KEY": self.config.api_key,
            "Content-Type": "application/json",
        }

        try:
            response = self._session.get(
                url,
                headers=headers,
                params=params,
                timeout=(self.config.connect_timeout_seconds, self.config.read_timeout_seconds),
            )
        except requests.Timeout as exc:
            raise UpstreamServiceError(status_code=504, public_message="Movie provider timeout") from exc
        except requests.RequestException as exc:
            raise UpstreamServiceError(
                status_code=502,
                public_message=f"Movie provider is unavailable: {exc}",
            ) from exc

        if response.status_code == 404:
            raise UpstreamServiceError(status_code=404, public_message="Movie not found")

        if response.status_code in {401, 403}:
            raise UpstreamServiceError(status_code=502, public_message="Movie provider authentication failed")

        if not response.ok:
            raise UpstreamServiceError(
                status_code=502,
                public_message=f"Movie provider returned an error (status={response.status_code})",
            )

        try:
            result = response.json()
        except ValueError as exc:
            raise UpstreamServiceError(status_code=502, public_message="Invalid response from movie provider") from exc

        if cache_key is not None:
            self._cache_set(cache_key, result, ttl)
        return result

    @staticmethod
    def _normalize_items(data: dict) -> List[dict]:
        return data.get("items") or data.get("films") or []

    @staticmethod
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

    @staticmethod
    def _merge_ranked(results: List[List[dict]], limit: int) -> List[dict]:
        merged: Dict[int, dict] = {}
        for result in results:
            for item in result:
                film_id = item.get("kinopoiskId") or item.get("filmId")
                if not film_id:
                    continue
                if film_id not in merged:
                    merged[film_id] = item
        ranked = sorted(merged.values(), key=KinopoiskService._build_score, reverse=True)
        return ranked[:limit]

    def _parse_categories(self, raw_categories: str) -> List[str]:
        if not raw_categories:
            return []
        values = [item.strip().lower() for item in raw_categories.split(",") if item.strip()]
        return [value for value in values if value == "all" or value in self.CATEGORY_CONFIG]

    @staticmethod
    def _resolve_api_type(requested_type: str, category_type: str) -> str:
        api_type = requested_type if requested_type != "ALL" else category_type
        return api_type if api_type in {"ALL", "FILM", "TV_SERIES"} else "ALL"

    def _fetch_category_movies(self, category: str, requested_type: str, page: int) -> List[dict]:
        cfg = self.CATEGORY_CONFIG.get(category)
        if not cfg:
            return []

        genre_id = cfg.get("genre_id")
        category_type = str(cfg.get("type") or "ALL").upper()
        api_type = self._resolve_api_type(requested_type=requested_type, category_type=category_type)

        params: Dict[str, Any] = {"order": "NUM_VOTE", "type": api_type, "page": page}
        if genre_id:
            params["genres"] = int(genre_id)

        data = self._kinopoisk_get("/api/v2.2/films", params=params)
        return self._normalize_items(data)

    def get_movies(
        self,
        *,
        mood: str,
        categories: str,
        content_type: str,
        page: int,
        limit: int,
    ) -> dict:
        selected_categories = self._parse_categories(categories)
        mood_key = mood.lower().strip()

        if not selected_categories and mood_key and mood_key != "all":
            if mood_key not in self.MOOD_GENRES:
                raise UpstreamServiceError(status_code=400, public_message="Unsupported mood")
            selected_categories = [mood_key]

        requested_type = content_type.upper().strip() if content_type else "ALL"
        if requested_type not in {"ALL", "FILM", "TV_SERIES"}:
            raise UpstreamServiceError(status_code=400, public_message="Unsupported content_type")

        if not selected_categories or "all" in selected_categories:
            data = self._kinopoisk_get(
                "/api/v2.2/films/collections",
                params={"type": "TOP_POPULAR_ALL", "page": page},
            )
            items = self._normalize_items(data)[:limit]
            return {
                "source": "kinopoisk",
                "page": page,
                "limit": limit,
                "total": len(items),
                "items": items,
            }

        categories_to_fetch = selected_categories[: self.config.max_category_filters]
        workers = min(self.config.upstream_max_workers, max(1, len(categories_to_fetch)))

        responses: List[List[dict]] = []
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_category = {
                executor.submit(self._fetch_category_movies, category, requested_type, page): category
                for category in categories_to_fetch
            }
            for future in as_completed(future_to_category):
                try:
                    category_items = future.result()
                    if category_items:
                        responses.append(category_items)
                except UpstreamServiceError:
                    continue
                except Exception:
                    continue

        if not responses:
            raise UpstreamServiceError(status_code=502, public_message="Unable to fetch movies from movie provider")

        merged_items = self._merge_ranked(responses, limit=limit)
        return {
            "source": "kinopoisk",
            "page": page,
            "limit": limit,
            "total": len(merged_items),
            "items": merged_items,
        }

    def get_movie_details(self, film_id: int) -> dict:
        return self._kinopoisk_get(f"/api/v2.2/films/{film_id}")

    def get_similar_movies(self, film_id: int) -> List[dict]:
        data = self._kinopoisk_get(f"/api/v2.2/films/{film_id}/similars")
        return data.get("items") or []

    def search_movies(self, query: str, limit: int = 30) -> dict:
        """Поиск по названию через Kinopoisk (search-by-keyword). Используется
        как запасной вариант, когда локальный каталог не покрыл запрос.

        Нормализует результаты под формат items приложения (как в каталоге).
        Ответ кэшируется в _kinopoisk_get, поэтому повторные запросы не тратят
        лимит Kinopoisk.
        """
        query = (query or "").strip()
        if not query:
            return {"source": "kinopoisk", "query": query, "total": 0, "items": []}

        data = self._kinopoisk_get(
            "/api/v2.1/films/search-by-keyword", {"keyword": query, "page": 1}
        )
        films = data.get("films") or []
        items: List[dict] = []
        for film in films[:limit]:
            if not isinstance(film, dict):
                continue
            film_id = film.get("filmId") or film.get("kinopoiskId")
            if not film_id:
                continue
            try:
                rating_kp = float(film.get("rating"))
            except (TypeError, ValueError):
                rating_kp = None
            items.append({
                "kinopoiskId": film_id,
                "filmId": film_id,
                "nameRu": film.get("nameRu") or "",
                "nameEn": film.get("nameEn") or "",
                "nameOriginal": film.get("nameEn") or "",
                "posterUrl": film.get("posterUrl") or "",
                "posterUrlPreview": film.get("posterUrlPreview") or film.get("posterUrl") or "",
                "ratingKinopoisk": rating_kp,
                "ratingVoteCount": film.get("ratingVoteCount") or 0,
                "year": film.get("year") or "",
                "description": film.get("description") or "",
                "filmLength": film.get("filmLength"),
                "genres": film.get("genres") or [],
                "countries": film.get("countries") or [],
                "type": film.get("type") or "FILM",
            })
        return {"source": "kinopoisk", "query": query, "total": len(items), "items": items}

    @staticmethod
    def _is_youtube_url(url: str) -> bool:
        return bool(re.search(r"(?:youtube\.com|youtu\.be)", url, re.IGNORECASE))

    @staticmethod
    def _is_kinopoisk_widget(url: str) -> bool:
        return bool(re.search(r"widgets\.kinopoisk\.ru/.+trailer", url, re.IGNORECASE))

    def get_movie_videos(self, film_id: int) -> List[dict]:
        normalized: List[dict] = []
        try:
            data = self._kinopoisk_get(f"/api/v2.2/films/{film_id}/videos")
            items = data.get("items") or []
            for item in items:
                if not isinstance(item, dict):
                    continue
                url = (item.get("url") or "").strip()
                if not url:
                    continue
                site = (item.get("site") or "").strip().upper()
                # YouTube убираем полностью — по требованию заменяем на VK Video.
                if site == "YOUTUBE" or self._is_youtube_url(url):
                    continue
                name = (item.get("name") or "").strip()
                normalized.append({"url": url, "name": name, "site": site})
        except UpstreamServiceError:
            # Kinopoisk failed — we still try VK search below.
            pass

        # Встраиваемый в приложение трейлер — это виджет Kinopoisk (рус. дубляж).
        # Если его нет, ищем трейлер в RuTube (замена бывшего YouTube-fallback).
        has_playable = any(self._is_kinopoisk_widget(v["url"]) for v in normalized)
        if not has_playable and self._rutube_search_enabled:
            rutube_item = self._find_rutube_trailer(film_id)
            if rutube_item:
                normalized.insert(0, rutube_item)

        # Порядок: сначала встраиваемые (виджет Kinopoisk и RuTube), потом остальное.
        normalized.sort(
            key=lambda v: 0 if (self._is_kinopoisk_widget(v["url"]) or v["site"] == "RUTUBE") else 1
        )
        return normalized

    # ------------------------------------------------------------------
    # YouTube search fallback
    # ------------------------------------------------------------------

    def _load_youtube_cache(self) -> Dict[str, dict]:
        try:
            if self._yt_cache_path.exists():
                with self._yt_cache_path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception as exc:
            logger.warning("Failed to load YouTube trailer cache: %s", exc)
        return {}

    def _save_youtube_cache_locked(self) -> None:
        try:
            self._yt_cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self._yt_cache_path.with_suffix(".tmp")
            with tmp_path.open("w", encoding="utf-8") as f:
                json.dump(self._yt_cache, f, ensure_ascii=False)
            tmp_path.replace(self._yt_cache_path)
        except Exception as exc:
            logger.warning("Failed to save YouTube trailer cache: %s", exc)

    def _get_ydl(self):
        if self._yt_ydl is not None:
            return self._yt_ydl
        try:
            from yt_dlp import YoutubeDL  # type: ignore
        except Exception as exc:
            logger.warning("yt-dlp is not installed, YouTube search disabled: %s", exc)
            self._yt_search_enabled = False
            return None
        self._yt_ydl = YoutubeDL(
            {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "extract_flat": True,
                "socket_timeout": 8,
                "cachedir": False,
            }
        )
        return self._yt_ydl

    def _build_search_query(self, details: dict) -> str:
        name_ru = (details.get("nameRu") or "").strip()
        name_en = (details.get("nameEn") or details.get("nameOriginal") or "").strip()
        year = details.get("year")
        year_part = f" {year}" if year else ""
        if name_en and name_ru and name_en.lower() != name_ru.lower():
            return f"{name_en} official trailer{year_part}"
        if name_ru:
            return f"{name_ru} трейлер{year_part}"
        if name_en:
            return f"{name_en} official trailer{year_part}"
        return ""

    def _search_youtube_video_id(self, query: str) -> Optional[str]:
        ydl = self._get_ydl()
        if ydl is None or not query:
            return None
        try:
            result = ydl.extract_info(f"ytsearch1:{query}", download=False)
        except Exception as exc:
            logger.warning("yt-dlp search failed for %r: %s", query, exc)
            return None
        entries = (result or {}).get("entries") or []
        if not entries:
            return None
        entry = entries[0] or {}
        video_id = (entry.get("id") or "").strip()
        return video_id or None

    def _find_youtube_trailer(self, film_id: int) -> Optional[dict]:
        key = str(int(film_id))
        with self._yt_cache_lock:
            cached = self._yt_cache.get(key)
        if cached and isinstance(cached, dict):
            video_id = (cached.get("video_id") or "").strip()
            if video_id:
                return {
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "name": cached.get("name") or "YouTube trailer",
                    "site": "YOUTUBE",
                }
            if cached.get("miss_at"):  # remembered a recent miss — do not retry too soon
                if time.time() - float(cached["miss_at"]) < 7 * 24 * 3600:
                    return None

        try:
            details = self.get_movie_details(int(film_id))
        except UpstreamServiceError:
            return None

        query = self._build_search_query(details or {})
        video_id = self._search_youtube_video_id(query) if query else None

        with self._yt_cache_lock:
            if video_id:
                self._yt_cache[key] = {"video_id": video_id, "query": query}
            else:
                self._yt_cache[key] = {"miss_at": time.time(), "query": query}
            self._save_youtube_cache_locked()

        if not video_id:
            return None
        return {
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "name": "YouTube trailer",
            "site": "YOUTUBE",
        }

    # ------------------------------------------------------------------
    # RuTube search (замена YouTube — работает в РФ, без токена)
    # ------------------------------------------------------------------

    def _load_rutube_cache(self) -> Dict[str, dict]:
        try:
            if self._rutube_cache_path.exists():
                with self._rutube_cache_path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception as exc:
            logger.warning("Failed to load RuTube trailer cache: %s", exc)
        return {}

    def _save_rutube_cache_locked(self) -> None:
        try:
            self._rutube_cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self._rutube_cache_path.with_suffix(".tmp")
            with tmp_path.open("w", encoding="utf-8") as f:
                json.dump(self._rutube_cache, f, ensure_ascii=False)
            tmp_path.replace(self._rutube_cache_path)
        except Exception as exc:
            logger.warning("Failed to save RuTube trailer cache: %s", exc)

    def _build_rutube_query(self, details: dict) -> str:
        # RuTube — русскоязычный, предпочитаем русское название и слово «трейлер».
        name_ru = (details.get("nameRu") or "").strip()
        name_en = (details.get("nameEn") or details.get("nameOriginal") or "").strip()
        year = details.get("year")
        year_part = f" {year}" if year else ""
        if name_ru:
            return f"{name_ru} трейлер{year_part}"
        if name_en:
            return f"{name_en} трейлер{year_part}"
        return ""

    def _rutube_search(
        self,
        query: str,
        min_duration: int = 20,
        max_duration: int = 420,
    ) -> Optional[dict]:
        """Ищет трейлер в RuTube через открытый поиск (без токена).

        Возвращает ``{"id": video_id, "name": title}`` или ``None``. Отсекает
        слишком короткие/длинные ролики (чтобы не подцепить полный фильм) и
        предпочитает видео со словом «трейлер»/«trailer» в названии.
        """
        if not query:
            return None
        try:
            resp = self._session.get(
                "https://rutube.ru/api/search/video/",
                params={"query": query},
                headers={
                    "Accept": "application/json",
                    # RuTube отдаёт 403 на запросы без браузерного User-Agent.
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                },
                timeout=(self.config.connect_timeout_seconds, self.config.read_timeout_seconds),
            )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("RuTube search failed for %r: %s", query, exc)
            return None

        results = data.get("results") or []
        best = None  # (score, item)
        for item in results:
            video_id = (item.get("id") or "").strip()
            if not video_id:
                continue
            duration = item.get("duration") or 0
            if not (min_duration <= duration <= max_duration):
                continue
            title = (item.get("title") or "")
            has_kw = "трейлер" in title.lower() or "trailer" in title.lower()
            score = 2 if has_kw else 1
            if best is None or score > best[0]:
                best = (score, {"id": video_id, "name": title.strip()})
            if score == 2:
                break

        return best[1] if best else None

    def search_film_videos(
        self,
        query: str,
        limit: int = 12,
        year: Optional[int] = None,
        runtime_minutes: Optional[int] = None,
    ) -> List[dict]:
        """Полные фильмы из RuTube и Mail.ru по названию, лучший результат первым.

        Каждому ролику ставится балл соответствия (см. ``_score_candidate``), в
        выдачу попадают только ролики с баллом не ниже ``WATCH_MIN_SCORE``.
        Сортировка: балл, затем RuTube раньше Mail.ru, затем просмотры.
        Возвращает ``[{id, source, title, duration, hits, yearMatch, score, embedUrl, thumbnail}]``.
        """
        wanted_compact = _normalize_title(query).replace(" ", "")
        if not wanted_compact:
            return []
        cache_key = (wanted_compact, int(year) if year else None, runtime_minutes, limit)
        now = time.time()
        with _rutube_search_cache_lock:
            cached = _rutube_search_cache.get(cache_key)
        if cached and now - cached[0] < RUTUBE_SEARCH_TTL_SECONDS:
            return copy.deepcopy(cached[1])

        year_text = str(year) if year else ""
        items = self._search_rutube_items(query, wanted_compact, year_text)
        items += self._search_mailru_items(query, wanted_compact, year_text)
        for item in items:
            item["score"] = _score_candidate(item, runtime_minutes)
        items = [it for it in items if it["score"] >= WATCH_MIN_SCORE]
        source_rank = {"rutube": 1, "mailru": 0}
        items.sort(key=lambda it: (it["score"], source_rank[it["source"]], it["hits"]), reverse=True)
        result = items[:limit]
        with _rutube_search_cache_lock:
            _rutube_search_cache[cache_key] = (now, copy.deepcopy(result))
        return result

    def _search_rutube_items(self, query: str, wanted_compact: str, year_text: str) -> List[dict]:
        try:
            resp = self._session.get(
                "https://rutube.ru/api/search/video/",
                params={"query": query.strip()},
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                },
                timeout=(self.config.connect_timeout_seconds, self.config.read_timeout_seconds),
            )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("RuTube search failed for %r: %s", query, exc)
            return []

        items: List[dict] = []
        for item in (data.get("results") or []):
            video_id = (item.get("id") or "").strip()
            title = (item.get("title") or "").strip()
            duration = int(item.get("duration") or 0)
            if not video_id or not _is_full_film_candidate(title, duration, wanted_compact):
                continue
            items.append({
                "id": video_id,
                "source": "rutube",
                "title": title,
                "duration": duration,
                "thumbnail": item.get("thumbnail_url") or "",
                "hits": int(item.get("hits") or 0),
                "yearMatch": bool(year_text and year_text in title),
                "embedUrl": f"https://rutube.ru/play/embed/{video_id}?autoplay=1",
            })
        return items

    def _search_mailru_items(self, query: str, wanted_compact: str, year_text: str) -> List[dict]:
        try:
            resp = self._session.get(
                MAILRU_SEARCH_URL,
                params={"q": query.strip()},
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                         "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"},
                timeout=(self.config.connect_timeout_seconds, self.config.read_timeout_seconds),
            )
            resp.raise_for_status()
            page = resp.text
        except requests.RequestException as exc:
            logger.warning("Mail.ru search failed for %r: %s", query, exc)
            return []

        items: List[dict] = []
        for block in _MAILRU_ITEM_RE.findall(page):
            href = _MAILRU_HREF_RE.search(block)
            duration = _MAILRU_DURATION_RE.search(block)
            title_match = _MAILRU_TITLE_RE.search(block)
            if not (href and duration and title_match):
                continue
            user, video_id = href.group(1), href.group(2)
            title = html.unescape(_TAG_RE.sub("", title_match.group(1))).strip()
            seconds = _parse_clock(duration.group(1))
            if not _is_full_film_candidate(title, seconds, wanted_compact):
                continue
            views = _MAILRU_VIEWS_RE.search(block)
            thumb = _MAILRU_THUMB_RE.search(block)
            items.append({
                "id": video_id,
                "source": "mailru",
                "title": title,
                "duration": seconds,
                "thumbnail": ("https:" + html.unescape(thumb.group(1))) if thumb and thumb.group(1).startswith("//") else "",
                "hits": _parse_views(views.group(1)) if views else 0,
                "yearMatch": bool(year_text and year_text in title),
                "embedUrl": f"https://my.mail.ru/mail/{user}/video/embed/video/{video_id}",
            })
        return items

    def _find_rutube_trailer(self, film_id: int) -> Optional[dict]:
        key = str(int(film_id))
        with self._rutube_cache_lock:
            cached = self._rutube_cache.get(key)
        if cached and isinstance(cached, dict):
            video_id = (cached.get("video_id") or "").strip()
            if video_id:
                return {
                    "url": f"https://rutube.ru/play/embed/{video_id}",
                    "name": cached.get("name") or "Трейлер RuTube",
                    "site": "RUTUBE",
                }
            if cached.get("miss_at"):  # недавний промах — не долбим RuTube повторно
                if time.time() - float(cached["miss_at"]) < 7 * 24 * 3600:
                    return None

        try:
            details = self.get_movie_details(int(film_id))
        except UpstreamServiceError:
            return None

        query = self._build_rutube_query(details or {})
        found = self._rutube_search(query) if query else None

        with self._rutube_cache_lock:
            if found:
                self._rutube_cache[key] = {
                    "video_id": found["id"],
                    "name": found.get("name") or "",
                    "query": query,
                }
            else:
                self._rutube_cache[key] = {"miss_at": time.time(), "query": query}
            self._save_rutube_cache_locked()

        if not found:
            return None
        return {
            "url": f"https://rutube.ru/play/embed/{found['id']}",
            "name": found.get("name") or "Трейлер RuTube",
            "site": "RUTUBE",
        }

    def get_recommendations(
        self,
        *,
        liked_ids: List[int],
        top_genres: List[str],
        blocked_genres: List[str],
        limit: int,
    ) -> dict:
        seen_ids: set = set()
        result: List[dict] = []

        similar_slots = max(1, int(limit * 0.4))
        genre_slots = max(1, int(limit * 0.4))

        recent_liked = liked_ids[-5:] if liked_ids else []
        for liked_id in reversed(recent_liked):
            if len(result) >= similar_slots:
                break
            try:
                similars = self.get_similar_movies(liked_id)
            except UpstreamServiceError:
                continue
            for item in similars:
                film_id = item.get("kinopoiskId") or item.get("filmId")
                if not film_id or film_id in seen_ids:
                    continue
                seen_ids.add(film_id)
                enriched = self._enrich_similar_item(item)
                if self._is_blocked(enriched, blocked_genres):
                    continue
                enriched["_source"] = "similar"
                result.append(enriched)
                if len(result) >= similar_slots:
                    break

        for genre in top_genres:
            if len(result) >= similar_slots + genre_slots:
                break
            cfg = self.CATEGORY_CONFIG.get(genre)
            if not cfg:
                continue
            try:
                params: Dict[str, Any] = {"order": "NUM_VOTE", "type": cfg.get("type", "ALL"), "page": 1}
                if cfg.get("genre_id"):
                    params["genres"] = int(cfg["genre_id"])
                data = self._kinopoisk_get("/api/v2.2/films", params=params)
                items = self._normalize_items(data)
            except UpstreamServiceError:
                continue
            for item in items:
                film_id = item.get("kinopoiskId") or item.get("filmId")
                if not film_id or film_id in seen_ids:
                    continue
                seen_ids.add(film_id)
                if self._is_blocked(item, blocked_genres):
                    continue
                item["_source"] = "genre"
                result.append(item)
                if len(result) >= similar_slots + genre_slots:
                    break

        if len(result) < limit:
            try:
                data = self._kinopoisk_get(
                    "/api/v2.2/films/collections",
                    params={"type": "TOP_POPULAR_ALL", "page": 1},
                )
                items = self._normalize_items(data)
            except UpstreamServiceError:
                items = []
            for item in items:
                if len(result) >= limit:
                    break
                film_id = item.get("kinopoiskId") or item.get("filmId")
                if not film_id or film_id in seen_ids:
                    continue
                seen_ids.add(film_id)
                if self._is_blocked(item, blocked_genres):
                    continue
                item["_source"] = "popular"
                result.append(item)

        return {
            "source": "recommendations",
            "total": len(result),
            "items": result,
        }

    def _enrich_similar_item(self, item: dict) -> dict:
        film_id = item.get("kinopoiskId") or item.get("filmId")
        if not film_id:
            return item
        try:
            details = self.get_movie_details(int(film_id))
            details["kinopoiskId"] = film_id
            return details
        except UpstreamServiceError:
            return item

    @staticmethod
    def _is_blocked(item: dict, blocked_genres: List[str]) -> bool:
        if not blocked_genres:
            return False
        genres = item.get("genres") or []
        genre_names = {
            (g.get("genre") if isinstance(g, dict) else str(g)).lower()
            for g in genres
        }
        return bool(genre_names & set(g.lower() for g in blocked_genres))

