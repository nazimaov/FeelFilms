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

        # Сначала ролики с названием фильма и словом «трейлер», потом просто «трейлер».
        name = title.lower()
        best_url, best_score, best_title, best_duration = None, 0, "", 0
        for item in data.get("results", []):
            url = item.get("video_url")
            duration = item.get("duration") or 0
            if not url or not (_MIN_DURATION <= duration <= _MAX_DURATION):
                continue
            video_title = (item.get("title") or "").lower()
            score = 0
            if "трейлер" in video_title or "trailer" in video_title:
                score = 1
                if name and name in video_title:
                    score = 2
            if score > best_score:
                best_url, best_score = url, score
                best_title, best_duration = item.get("title") or "", duration
            if best_score == 2:
                break

        if best_url:
            logger.info(
                "Найден трейлер на RuTube: «%s» (%ss) %s",
                best_title[:60], best_duration, best_url,
            )
            return best_url

        logger.info("Подходящего трейлера на RuTube не найдено: %s", query)
        return None
