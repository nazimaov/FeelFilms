"""Поиск актуального материала о кино.

Архитектура рассчитана на расширение: :class:`NewsSource` — абстрактный
источник, а конкретные реализации (Kinopoisk и любые будущие) поставляют
единый :class:`NewsItem`. Добавить новый источник = написать ещё один
класс-наследник и зарегистрировать его в :class:`NewsFetcher`.
"""

from __future__ import annotations

import abc
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

import requests

from .content_types import SELECT_PREMIERES, ContentType
from .logger import get_logger
from .posted_store import PostedStore

logger = get_logger("news_fetcher")

# Английские названия месяцев для эндпоинта премьер Kinopoisk.
_KP_MONTHS = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]


@dataclass
class NewsItem:
    """Единый формат материала для генерации поста."""

    key: str                       # стабильный ключ дедупликации, напр. "kinopoisk:301"
    source: str
    kind: str                      # "film" | "series"
    title: str
    original_title: str = ""
    year: Optional[int] = None
    genres: List[str] = field(default_factory=list)
    countries: List[str] = field(default_factory=list)
    rating: Optional[float] = None
    description: str = ""
    poster_url: str = ""
    premiere_date: str = ""        # ISO-строка, если известна
    trailer_url: str = ""
    film_id: Optional[int] = None

    # Заполняется планировщиком контента перед генерацией текста.
    content_type: Optional[ContentType] = None


class NewsSource(abc.ABC):
    """Абстрактный источник новостей."""

    name: str = "abstract"

    @abc.abstractmethod
    def fetch(self, selection: str, limit: int = 40) -> List[NewsItem]:
        """Возвращает список кандидатов по стратегии выбора."""
        raise NotImplementedError

    def enrich(self, item: NewsItem) -> NewsItem:
        """Дополняет материал деталями (описание, трейлер). По умолчанию — как есть."""
        return item


class KinopoiskSource(NewsSource):
    """Источник на базе неофициального Kinopoisk API (тот же, что в backend)."""

    name = "kinopoisk"

    def __init__(self, api_key: str, api_base: str, timeout: float = 20.0) -> None:
        self._api_key = api_key
        self._api_base = api_base.rstrip("/")
        self._timeout = timeout
        self._session = requests.Session()

    # --- HTTP ---
    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        url = f"{self._api_base}{path}"
        headers = {"X-API-KEY": self._api_key, "Content-Type": "application/json"}
        resp = self._session.get(url, headers=headers, params=params, timeout=self._timeout)
        resp.raise_for_status()
        return resp.json()

    # --- Преобразование сырого ответа в NewsItem ---
    @staticmethod
    def _to_item(raw: dict) -> Optional[NewsItem]:
        film_id = raw.get("kinopoiskId") or raw.get("filmId")
        if not film_id:
            return None

        title = (raw.get("nameRu") or raw.get("nameEn") or raw.get("nameOriginal") or "").strip()
        if not title:
            return None

        genres = [g.get("genre") for g in (raw.get("genres") or []) if isinstance(g, dict) and g.get("genre")]
        countries = [c.get("country") for c in (raw.get("countries") or []) if isinstance(c, dict) and c.get("country")]

        rating_raw = raw.get("ratingKinopoisk") or raw.get("rating")
        try:
            rating = float(rating_raw) if rating_raw not in (None, "null", "") else None
        except (TypeError, ValueError):
            rating = None

        kind = "series" if (raw.get("type") in {"TV_SERIES", "MINI_SERIES", "TV_SHOW"} or raw.get("serial")) else "film"

        return NewsItem(
            key=f"kinopoisk:{film_id}",
            source="kinopoisk",
            kind=kind,
            title=title,
            original_title=(raw.get("nameEn") or raw.get("nameOriginal") or "").strip(),
            year=raw.get("year"),
            genres=genres,
            countries=countries,
            rating=rating,
            description=(raw.get("shortDescription") or raw.get("description") or "").strip(),
            poster_url=(raw.get("posterUrl") or "").strip(),
            premiere_date=(raw.get("premiereRu") or raw.get("premiereWorld") or "").strip(),
            film_id=int(film_id),
        )

    def fetch(self, selection: str, limit: int = 40) -> List[NewsItem]:
        if selection == SELECT_PREMIERES:
            raw_items = self._fetch_premieres()
        else:
            raw_items = self._fetch_popular()

        items: List[NewsItem] = []
        for raw in raw_items[:limit]:
            item = self._to_item(raw)
            if item:
                items.append(item)
        return items

    def _fetch_premieres(self) -> List[dict]:
        """Премьеры текущего и следующего месяца."""
        now = datetime.now()
        months = [(now.year, now.month)]
        # добавляем следующий месяц, чтобы всегда был запас новинок
        if now.month == 12:
            months.append((now.year + 1, 1))
        else:
            months.append((now.year, now.month + 1))

        collected: List[dict] = []
        for year, month in months:
            try:
                data = self._get(
                    "/api/v2.2/films/premieres",
                    params={"year": year, "month": _KP_MONTHS[month - 1]},
                )
                collected.extend(data.get("items") or [])
            except requests.RequestException as exc:
                logger.warning("Не удалось получить премьеры %s-%s: %s", year, month, exc)
        return collected

    def _fetch_popular(self) -> List[dict]:
        """Популярные фильмы (несколько страниц для разнообразия)."""
        collected: List[dict] = []
        for page in (1, 2, 3):
            try:
                data = self._get(
                    "/api/v2.2/films/collections",
                    params={"type": "TOP_POPULAR_ALL", "page": page},
                )
                collected.extend(data.get("items") or data.get("films") or [])
            except requests.RequestException as exc:
                logger.warning("Не удалось получить популярное (стр. %s): %s", page, exc)
                break
        return collected

    def enrich(self, item: NewsItem) -> NewsItem:
        """Догружает подробное описание и ссылку на трейлер."""
        if not item.film_id:
            return item

        # Полное описание, если в кратком варианте его не было.
        try:
            details = self._get(f"/api/v2.2/films/{item.film_id}")
            if not item.description:
                item.description = (details.get("shortDescription") or details.get("description") or "").strip()
            if not item.rating and details.get("ratingKinopoisk"):
                try:
                    item.rating = float(details["ratingKinopoisk"])
                except (TypeError, ValueError):
                    pass
            if not item.poster_url:
                item.poster_url = (details.get("posterUrl") or "").strip()
        except requests.RequestException as exc:
            logger.warning("Не удалось получить детали фильма %s: %s", item.film_id, exc)

        # Трейлер НЕ берём из Kinopoisk (там только YouTube-ссылки и виджеты).
        # Трейлер прикрепляется исключительно как видео из VK — см. main.py.
        return item


class NewsFetcher:
    """Оркестратор источников: выбирает свежий, ещё не опубликованный материал."""

    def __init__(self, sources: List[NewsSource], store: PostedStore, min_rating: float = 0.0) -> None:
        self._sources = sources
        self._store = store
        self._min_rating = min_rating

    def next_item(self, content_type: ContentType) -> Optional[NewsItem]:
        """Ищет подходящий материал под заданный тип контента.

        Возвращает уже обогащённый :class:`NewsItem` или ``None``, если
        свежих кандидатов не осталось.
        """
        candidates: List[NewsItem] = []
        for source in self._sources:
            try:
                candidates.extend(source.fetch(content_type.selection))
            except requests.RequestException as exc:
                logger.warning("Источник %s недоступен: %s", source.name, exc)

        # Фильтруем: убираем дубликаты, слабый рейтинг и уже опубликованное.
        fresh: List[NewsItem] = []
        seen_keys = set()
        for item in candidates:
            if item.key in seen_keys or self._store.is_posted(item.key):
                continue
            if self._min_rating and item.rating is not None and item.rating < self._min_rating:
                continue
            seen_keys.add(item.key)
            fresh.append(item)

        if not fresh:
            logger.info("Свежих материалов под тип '%s' не найдено.", content_type.key)
            return None

        # Немного случайности, чтобы посты не шли строго по рейтингу/дате.
        random.shuffle(fresh)
        chosen = fresh[0]
        chosen.content_type = content_type

        # Обогащаем выбранный материал у его источника.
        for source in self._sources:
            if source.name == chosen.source:
                chosen = source.enrich(chosen)
                chosen.content_type = content_type
                break

        logger.info(
            "Выбран материал: %s (%s, тип '%s', рейтинг %s)",
            chosen.title, chosen.key, content_type.key, chosen.rating,
        )
        return chosen
