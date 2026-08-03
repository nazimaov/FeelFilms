"""Конфигурация бота FeelFilm.

Все настройки (токены, расписание, источники, параметры) хранятся в одном
месте и загружаются из переменных окружения / файла ``.env``.

Скопируйте ``.env.example`` в ``.env`` и заполните значения — так секреты
не попадут в git.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import List

from dotenv import load_dotenv

# Корень пакета vk_bot — относительно него считаем пути по умолчанию.
BASE_DIR = Path(__file__).resolve().parent

# Загружаем .env из папки бота (если он есть). override=False, чтобы уже
# выставленные в окружении переменные (например, на сервере) имели приоритет.
# encoding="utf-8-sig" снимает BOM — иначе Notepad/Windows-файлы ломают
# первую переменную (она читается как "﻿VK_TOKEN" и «теряется»).
load_dotenv(BASE_DIR / ".env", override=False, encoding="utf-8-sig")


def _get(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


def _get_int(name: str, default: int) -> int:
    raw = _get(name, str(default))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _get_float(name: str, default: float) -> float:
    raw = _get(name, str(default))
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _get_bool(name: str, default: bool) -> bool:
    raw = _get(name, "1" if default else "0").lower()
    return raw in {"1", "true", "yes", "on", "да"}


def _get_list(name: str, default: str = "") -> List[str]:
    raw = _get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Config:
    """Единый объект настроек, который прокидывается во все модули."""

    # --- VK ---
    vk_token: str
    vk_group_id: int
    vk_api_version: str

    # --- Источник новостей (Kinopoisk) ---
    kinopoisk_api_key: str
    kinopoisk_api_base: str

    # --- ИИ-генерация текста ---
    ai_provider: str            # "openai" (OpenAI-совместимый API) или "template"
    ai_api_key: str
    ai_base_url: str
    ai_model: str
    ai_temperature: float

    # --- Расписание ---
    # Режим "times": публикуем в перечисленные часы каждый день (по TZ).
    # Режим "interval": публикуем раз в N часов.
    schedule_mode: str          # "times" | "interval"
    post_times: List[str]       # ["10:00", "16:00", "20:00"]
    interval_hours: float
    timezone: str
    post_on_start: bool         # опубликовать сразу при запуске

    # --- Контент ---
    content_types: List[str]    # какие типы постов чередовать
    hashtags: str               # приписка в конце поста
    cta: str                    # призыв к действию (реклама приложения) перед хэштегами
    min_rating: float           # не постить фильмы ниже этого рейтинга (0 = не фильтровать)
    attach_trailer_link: bool   # добавлять ссылку на трейлер в текст

    # --- Хранилище и логи ---
    posted_store_path: Path
    log_file: Path
    log_level: str

    # --- Сеть ---
    request_timeout: float = 20.0

    @property
    def owner_id(self) -> int:
        """owner_id стены сообщества (для VK API это -group_id)."""
        return -abs(self.vk_group_id)


def load_config() -> Config:
    """Собирает :class:`Config` из окружения и валидирует критичные поля."""

    cfg = Config(
        vk_token=_get("VK_TOKEN"),
        vk_group_id=_get_int("VK_GROUP_ID", 0),
        vk_api_version=_get("VK_API_VERSION", "5.199"),
        kinopoisk_api_key=_get("KINOPOISK_API_KEY"),
        kinopoisk_api_base=_get("KINOPOISK_API_BASE", "https://kinopoiskapiunofficial.tech").rstrip("/"),
        ai_provider=_get("AI_PROVIDER", "template").lower(),
        ai_api_key=_get("AI_API_KEY"),
        ai_base_url=_get("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        ai_model=_get("AI_MODEL", "gpt-4o-mini"),
        ai_temperature=_get_float("AI_TEMPERATURE", 0.8),
        schedule_mode=_get("SCHEDULE_MODE", "times").lower(),
        post_times=_get_list("POST_TIMES", "10:00,16:00,20:00"),
        interval_hours=_get_float("INTERVAL_HOURS", 6.0),
        timezone=_get("TIMEZONE", "Europe/Moscow"),
        post_on_start=_get_bool("POST_ON_START", False),
        content_types=_get_list("CONTENT_TYPES", "premiere,recommendation,fact"),
        hashtags=_get("HASHTAGS", "#FeelFilm #кино #чтопосмотреть"),
        cta=_get(
            "CTA",
            "📲 Скачивайте приложение FeelFilm, чтобы найти свой фильм: "
            "https://www.rustore.ru/catalog/app/com.feelfilm.app",
        ),
        min_rating=_get_float("MIN_RATING", 0.0),
        attach_trailer_link=_get_bool("ATTACH_TRAILER_LINK", True),
        posted_store_path=Path(_get("POSTED_STORE_PATH", str(BASE_DIR / "data" / "posted.json"))),
        log_file=Path(_get("LOG_FILE", str(BASE_DIR / "data" / "bot.log"))),
        log_level=_get("LOG_LEVEL", "INFO").upper(),
        request_timeout=_get_float("REQUEST_TIMEOUT_SECONDS", 20.0),
    )
    return cfg


def validate_config(cfg: Config) -> List[str]:
    """Возвращает список проблем конфигурации (пустой = всё в порядке)."""
    problems: List[str] = []

    if not cfg.vk_token:
        problems.append("VK_TOKEN не задан — без него нельзя публиковать посты.")
    if not cfg.vk_group_id:
        problems.append("VK_GROUP_ID не задан (числовой ID сообщества, без минуса).")
    if not cfg.kinopoisk_api_key:
        problems.append("KINOPOISK_API_KEY не задан — нечем брать новости о фильмах.")
    if cfg.ai_provider == "openai" and not cfg.ai_api_key:
        problems.append(
            "AI_PROVIDER=openai, но AI_API_KEY пуст. Задайте ключ или переключитесь на AI_PROVIDER=template."
        )
    if cfg.schedule_mode not in {"times", "interval"}:
        problems.append(f"Неизвестный SCHEDULE_MODE='{cfg.schedule_mode}' (ожидается 'times' или 'interval').")

    return problems
