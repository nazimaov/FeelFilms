"""Поиск трейлеров в RuTube.

Публичное поисковое API rutube.ru работает без токена и стабильно
проигрывается в РФ. Возвращаем прямую ссылку на ролик — она либо
вставляется в текст поста (VK превращает URL в превью-карточку с
плеером), либо игнорируется, если ничего подходящего не нашлось.

Отсекаем слишком короткие клипы (тизеры/нарезки) и слишком длинные
(полные фильмы, обзоры) — оставляем то, что похоже на настоящий
трейлер: 20..900 секунд, как и в VK-версии поиска.
"""

from __future__ import annotations

from typing import Optional

import requests

from .logger import get_logger

logger = get_logger("trailer_search")

_SEARCH_URL = "https://rutube.ru/api/search/video/"
_MIN_DURATION = 20
_MAX_DURATION = 900


class RutubeTrailerSearch:
    def __init__(self, timeout: float = 15.0) -> None:
        self._timeout = timeout
        self._session = requests.Session()
        # RuTube иногда отдаёт 403 клиентам без User-Agent.
        self._session.headers.update({"User-Agent": "Mozilla/5.0 FeelFilmBot"})

    def search(self, title: str, year: Optional[int] = None) -> Optional[str]:
        """Возвращает URL трейлера с RuTube или ``None``."""
        if not title:
            return None

        query = f"{title} трейлер"
        if year:
            query += f" {year}"

        try:
            resp = self._session.get(
                _SEARCH_URL,
                params={"query": query, "page": 1},
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("Поиск трейлера на RuTube не удался (%s): %s", query, exc)
            return None

        for item in data.get("results", []):
            url = item.get("video_url")
            duration = item.get("duration") or 0
            if not url:
                continue
            if not (_MIN_DURATION <= duration <= _MAX_DURATION):
                continue
            logger.info(
                "Найден трейлер на RuTube: «%s» (%ss) %s",
                (item.get("title") or "")[:60], duration, url,
            )
            return url

        logger.info("Подходящего трейлера на RuTube не найдено: %s", query)
        return None
