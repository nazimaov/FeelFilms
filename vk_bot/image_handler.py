"""Работа с изображениями (постерами).

Скачивает официальный постер по URL и готовит его к загрузке во ВКонтакте.
Использует только официальные ссылки Kinopoisk из данных о фильме, что
удовлетворяет требованию ТЗ о «разрешённом изображении».
"""

from __future__ import annotations

from typing import Optional

import requests

from .logger import get_logger

logger = get_logger("image_handler")

# VK принимает JPG/PNG/GIF. Ограничим разумным размером.
_MAX_BYTES = 20 * 1024 * 1024  # 20 МБ
_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/gif"}


class ImageHandler:
    def __init__(self, timeout: float = 20.0) -> None:
        self._timeout = timeout
        self._session = requests.Session()

    def download(self, url: str) -> Optional[bytes]:
        """Возвращает байты изображения или ``None``, если скачать не удалось."""
        if not url:
            return None
        try:
            resp = self._session.get(url, timeout=self._timeout, stream=True)
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.warning("Не удалось скачать постер %s: %s", url, exc)
            return None

        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
            logger.warning("Постер имеет неподдерживаемый тип %s (%s)", content_type, url)
            return None

        data = resp.content
        if not data:
            logger.warning("Пустой ответ при скачивании постера %s", url)
            return None
        if len(data) > _MAX_BYTES:
            logger.warning("Постер слишком большой (%d байт), пропускаем", len(data))
            return None

        logger.debug("Постер скачан: %d байт (%s)", len(data), url)
        return data
