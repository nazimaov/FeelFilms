"""Настройка журналирования (логирования) работы бота.

Пишем одновременно в консоль и в файл с ротацией, чтобы журнал не рос
бесконечно, но при этом сохранялась история публикаций и ошибок.
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

_LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s — %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging(log_file: Path, level: str = "INFO") -> logging.Logger:
    """Инициализирует корневой логгер бота и возвращает именованный логгер."""

    log_file = Path(log_file)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger("feelfilm.vkbot")
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.propagate = False

    # Повторный вызов не должен плодить хендлеры (важно при перезапусках/тестах).
    if root.handlers:
        return root

    formatter = logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=2_000_000,   # ~2 МБ на файл
        backupCount=5,        # храним 5 архивов
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    return root


def get_logger(name: str) -> logging.Logger:
    """Дочерний логгер в общем пространстве имён бота."""
    return logging.getLogger(f"feelfilm.vkbot.{name}")
