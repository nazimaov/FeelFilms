"""Типы контента, которые умеет публиковать бот.

Вынесено в отдельный модуль, чтобы легко добавлять новые форматы постов
(ТЗ: «возможность публикации нескольких типов контента»). Каждый тип
описывает, откуда брать материал и в каком стиле генерировать текст.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

# Стратегии выбора материала из источника новостей.
SELECT_PREMIERES = "premieres"   # ближайшие премьеры (новинки с датами)
SELECT_POPULAR = "popular"       # популярные фильмы/сериалы


@dataclass(frozen=True)
class ContentType:
    key: str
    label: str          # человекочитаемое название (для логов)
    selection: str      # какая стратегия выбора материала
    intent: str         # подсказка для ИИ — о чём и в каком тоне пост


# Реестр доступных типов. Чтобы добавить новый формат — допишите сюда запись
# и (при необходимости) новую стратегию выбора в news_fetcher.py.
CONTENT_TYPES: Dict[str, ContentType] = {
    "premiere": ContentType(
        key="premiere",
        label="Премьера / новинка",
        selection=SELECT_PREMIERES,
        intent=(
            "Новость о новом фильме или сериале, который скоро выходит или "
            "только вышел. Сделай акцент на дате премьеры и на том, чем кино "
            "интересно."
        ),
    ),
    "recommendation": ContentType(
        key="recommendation",
        label="Рекомендация к просмотру",
        selection=SELECT_POPULAR,
        intent=(
            "Тёплая личная рекомендация «что посмотреть сегодня вечером». "
            "Объясни, кому и под какое настроение зайдёт этот фильм."
        ),
    ),
    "collection": ContentType(
        key="collection",
        label="Подборка / повод пересмотреть",
        selection=SELECT_POPULAR,
        intent=(
            "Пост-повод обсудить популярный фильм: почему он до сих пор на слуху "
            "и стоит ли пересмотра."
        ),
    ),
    "fact": ContentType(
        key="fact",
        label="Интересный факт",
        selection=SELECT_POPULAR,
        intent=(
            "Пост с интересным фактом или любопытным ракурсом об известном "
            "фильме. Лёгкий, вовлекающий тон."
        ),
    ),
}


def resolve_enabled(enabled: List[str]) -> List[ContentType]:
    """Оставляет только известные типы в порядке из конфига."""
    result = [CONTENT_TYPES[key] for key in enabled if key in CONTENT_TYPES]
    return result or [CONTENT_TYPES["premiere"]]


def pick(enabled: List[ContentType], counter: int) -> ContentType:
    """Циклически выбирает тип контента по счётчику публикаций (round-robin)."""
    return enabled[counter % len(enabled)]
