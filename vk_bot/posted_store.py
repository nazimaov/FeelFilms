"""Хранилище состояния бота.

Отвечает за два требования:
- «не публиковать одинаковые новости дважды» — множество ключей опубликованного;
- корректное чередование типов контента между независимыми запусками
  (важно для режима GitHub Actions, где каждый пост — отдельный процесс):
  счётчик публикаций тоже хранится здесь.

Формат файла::

    {
      "meta":  {"counter": 3},
      "posts": {"kinopoisk:123": {"posted_at": 1690000000, "title": "..."}}
    }

Поддерживается миграция со старого «плоского» формата ``{key: record}``.
Запись атомарная (через временный файл), чтобы падение процесса не билo файл.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Dict, Tuple

from .logger import get_logger

logger = get_logger("posted_store")


class PostedStore:
    def __init__(self, path: Path, max_history: int = 2000) -> None:
        self._path = Path(path)
        self._max_history = max_history
        self._posts, self._meta = self._load()

    def _load(self) -> Tuple[Dict[str, dict], Dict[str, object]]:
        try:
            if self._path.exists():
                with self._path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    # Новый формат.
                    if isinstance(data.get("posts"), dict):
                        return data["posts"], dict(data.get("meta") or {})
                    # Старый плоский формат: сам словарь — это posts.
                    return data, {}
        except Exception as exc:  # noqa: BLE001 — журнал не должен ломать запуск
            logger.warning("Не удалось прочитать хранилище %s: %s", self._path, exc)
        return {}, {}

    def _save(self) -> None:
        # Ограничиваем историю публикаций, чтобы файл не рос бесконечно:
        # оставляем самые свежие записи по времени публикации.
        if len(self._posts) > self._max_history:
            ordered = sorted(
                self._posts.items(),
                key=lambda kv: kv[1].get("posted_at", 0),
                reverse=True,
            )
            self._posts = dict(ordered[: self._max_history])

        payload = {"meta": self._meta, "posts": self._posts}
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp.replace(self._path)
        except Exception as exc:  # noqa: BLE001
            logger.error("Не удалось сохранить хранилище %s: %s", self._path, exc)

    # --- Дедупликация ---
    def is_posted(self, key: str) -> bool:
        return key in self._posts

    def mark_posted(self, key: str, meta: dict | None = None) -> None:
        record = {"posted_at": int(time.time())}
        if meta:
            record.update(meta)
        self._posts[key] = record
        self._save()

    def __len__(self) -> int:
        return len(self._posts)

    # --- Счётчик для чередования типов контента ---
    def next_counter(self) -> int:
        """Возвращает текущее значение счётчика и увеличивает его на диске.

        Благодаря этому round-robin по типам контента работает даже когда
        каждый запуск бота — отдельный процесс (cron / GitHub Actions).
        """
        current = int(self._meta.get("counter", 0) or 0)
        self._meta["counter"] = current + 1
        self._save()
        return current
