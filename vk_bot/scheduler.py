"""Планировщик публикаций.

Самодостаточная реализация без внешних зависимостей. Поддерживает два режима:

- ``times``    — публикация в заданные часы каждый день (например, 10:00, 16:00, 20:00);
- ``interval`` — публикация раз в N часов.

Время считается в указанной таймзоне (по умолчанию Europe/Moscow).
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Callable, List

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — на очень старых Python
    ZoneInfo = None  # type: ignore

from .logger import get_logger

logger = get_logger("scheduler")


class Scheduler:
    def __init__(
        self,
        mode: str,
        post_times: List[str],
        interval_hours: float,
        timezone: str = "Europe/Moscow",
    ) -> None:
        self._mode = mode
        self._interval = timedelta(hours=max(0.1, interval_hours))
        self._tz = ZoneInfo(timezone) if ZoneInfo else None
        self._times = self._parse_times(post_times)

    def _now(self) -> datetime:
        return datetime.now(self._tz) if self._tz else datetime.now()

    @staticmethod
    def _parse_times(values: List[str]) -> List[tuple[int, int]]:
        parsed: List[tuple[int, int]] = []
        for value in values:
            try:
                hh, mm = value.split(":")
                hour, minute = int(hh), int(mm)
                if 0 <= hour < 24 and 0 <= minute < 60:
                    parsed.append((hour, minute))
            except (ValueError, AttributeError):
                logger.warning("Некорректное время в расписании: %r — пропущено", value)
        parsed.sort()
        return parsed or [(10, 0)]

    def _next_run(self, after: datetime) -> datetime:
        if self._mode == "interval":
            return after + self._interval

        # Режим "times": ближайшее время из списка сегодня или завтра.
        for hour, minute in self._times:
            candidate = after.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > after:
                return candidate
        # Все точки на сегодня прошли — берём первую завтрашнюю.
        first_hour, first_minute = self._times[0]
        tomorrow = after + timedelta(days=1)
        return tomorrow.replace(hour=first_hour, minute=first_minute, second=0, microsecond=0)

    def run(self, job: Callable[[], None]) -> None:
        """Блокирующий цикл: ждёт очередной момент и вызывает ``job``.

        Исключения внутри ``job`` логируются, но не останавливают планировщик.
        """
        logger.info(
            "Планировщик запущен. Режим=%s, времена=%s, интервал=%.1fч",
            self._mode,
            [f"{h:02d}:{m:02d}" for h, m in self._times],
            self._interval.total_seconds() / 3600,
        )
        while True:
            now = self._now()
            next_run = self._next_run(now)
            wait_seconds = max(1.0, (next_run - now).total_seconds())
            logger.info(
                "Следующая публикация: %s (через %.0f мин)",
                next_run.strftime("%Y-%m-%d %H:%M"),
                wait_seconds / 60,
            )
            self._sleep(wait_seconds)

            try:
                job()
            except Exception as exc:  # noqa: BLE001 — цикл не должен падать
                logger.exception("Ошибка при выполнении задачи публикации: %s", exc)

    @staticmethod
    def _sleep(seconds: float) -> None:
        """Спит частями, чтобы корректно реагировать на Ctrl+C."""
        end = time.monotonic() + seconds
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 30.0))
