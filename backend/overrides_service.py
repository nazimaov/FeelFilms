"""Хранит и применяет ручные правки данных фильмов (админ-панель).

Задача: админ может через панель поменять поля фильма (название, описание,
жанры, постер, URL трейлера). Эти правки лежат отдельно от каталога, чтобы
ежедневная пересборка ``catalog.json`` их не затирала. При чтении данных
(лента, детали, видео) правки применяются «поверх» исходных полей — так что
приложение видит уже подменённое.

Файлы:
- ``overrides.json`` — текущее состояние ``{movieId: {field: value, ...}}``.
- ``overrides_history.json`` — история версий, чтобы откатывать.
"""

from __future__ import annotations

import copy
import json
import logging
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("feelfilms.overrides")


def normalize_trailer_url(url: str) -> str:
    """Приводит ссылку на трейлер к embed-виду. Админ часто копирует обычную
    страницу RuTube (``/video/{id}/``) или короткую ссылку — конвертируем в
    рабочий встраиваемый плеер ``/play/embed/{id}``. Виджет Кинопоиска и
    прочие уже-embed ссылки не трогаем."""
    if not url:
        return url
    s = url.strip()
    if not s:
        return s
    # RuTube: обычная страница -> embed. Ловим оба варианта rutube.ru/ru.tube и
    # rutube.ru/video/HEX/ (иногда пользователь копирует со слэшем и без).
    m = re.match(
        r"^https?://(?:www\.)?rutube\.ru/(?:video(?:/private)?/([A-Za-z0-9_-]+)|play/embed/([A-Za-z0-9_-]+))/?",
        s,
        re.IGNORECASE,
    )
    if m:
        vid = m.group(1) or m.group(2)
        if vid:
            return f"https://rutube.ru/play/embed/{vid}"
    return s

# Поля, которые можно править через админку. Всё остальное игнорируется —
# защита от случайных инъекций чужих полей.
ALLOWED_FIELDS = {
    "nameRu",
    "nameEn",
    "nameOriginal",
    "description",
    "shortDescription",
    "year",
    "posterUrl",
    "posterUrlPreview",
    "genres",           # массив строк ["боевик", "триллер"] — нормализуется под формат каталога
    "trailerUrl",       # ссылка на встраиваемый плеер (RuTube embed или widget Kinopoisk)
    "trailerName",
}

MAX_HISTORY = 200  # версий на фильм суммарно храним последние 200 записей


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_genres(value: Any) -> Any:
    """Приводит genres из строки CSV / массива строк / массива {genre: "..."}
    к формату каталога — массив ``[{"genre": "..."}]``."""
    if value is None:
        return None
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",") if p.strip()]
        return [{"genre": p} for p in parts]
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, dict) and item.get("genre"):
                out.append({"genre": str(item["genre"]).strip()})
            elif isinstance(item, str) and item.strip():
                out.append({"genre": item.strip()})
        return out
    return None


def _sanitize(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Берём только разрешённые поля и приводим их к рабочему формату."""
    out: Dict[str, Any] = {}
    for key in ALLOWED_FIELDS:
        if key not in fields:
            continue
        val = fields[key]
        if key == "genres":
            val = _normalize_genres(val)
        elif isinstance(val, str):
            val = val.strip()
        if key == "trailerUrl" and isinstance(val, str) and val:
            # Приводим страницу RuTube к embed-виду, чтобы «просто скопированная»
            # ссылка сразу проигрывалась в приложении.
            val = normalize_trailer_url(val)
        if val is None or val == "":
            # Пустое значение = снять override для этого поля.
            out[key] = None
        else:
            out[key] = val
    return out


class OverridesService:
    """Простое persistent-хранилище правок фильмов + история версий."""

    def __init__(self, path: Path, history_path: Optional[Path] = None) -> None:
        self._path = Path(path)
        self._history_path = Path(history_path) if history_path else self._path.with_name("overrides_history.json")
        self._lock = threading.RLock()
        self._data: Dict[str, Dict[str, Any]] = self._load(self._path, default={})
        self._mtime: Optional[float] = self._current_mtime()
        raw_history = self._load(self._history_path, default=[])
        self._history: List[dict] = raw_history if isinstance(raw_history, list) else []

    def _current_mtime(self) -> Optional[float]:
        try:
            return self._path.stat().st_mtime if self._path.exists() else None
        except OSError:
            return None

    def _reload_if_changed(self) -> None:
        """Если файл overrides менялся снаружи — перечитать. Внутренние
        write-операции сами обновляют in-memory + mtime, так что тут не сработает."""
        try:
            mtime = self._current_mtime()
            if mtime != self._mtime:
                with self._lock:
                    self._data = self._load(self._path, default={})
                    self._mtime = mtime
        except OSError:
            pass

    # ------------------------------------------------------------------
    @staticmethod
    def _load(path: Path, default):
        try:
            if not path.exists():
                return default if not isinstance(default, list) else []
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(default, list) and not isinstance(data, list):
                return []
            if isinstance(default, dict) and not isinstance(data, dict):
                return {}
            return data
        except Exception as exc:  # noqa: BLE001
            logger.error("Не удалось прочитать %s: %s", path, exc)
            return copy.deepcopy(default)

    def _save(self, path: Path, data) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            tmp.replace(path)
            # Обновляем mtime сразу — чтобы наш собственный write не
            # спровоцировал ложный reload из файла.
            if path == self._path:
                self._mtime = self._current_mtime()
        except Exception as exc:  # noqa: BLE001
            logger.error("Не удалось сохранить %s: %s", path, exc)

    # ------------------------------------------------------------------
    def get(self, movie_id: int) -> Dict[str, Any]:
        self._reload_if_changed()
        with self._lock:
            return copy.deepcopy(self._data.get(str(int(movie_id)), {}))

    def has_field(self, movie_id: int, field: str) -> bool:
        self._reload_if_changed()
        with self._lock:
            return field in self._data.get(str(int(movie_id)), {})

    def get_trailer_url(self, movie_id: int) -> Optional[str]:
        return self.get(movie_id).get("trailerUrl") or None

    # ------------------------------------------------------------------
    def apply_to_movie(self, movie: dict) -> dict:
        """Возвращает копию словаря фильма с применёнными правками.
        `trailerUrl` в сам объект фильма не пишем — трейлеры отдельно."""
        if not isinstance(movie, dict):
            return movie
        self._reload_if_changed()
        movie_id = movie.get("kinopoiskId") or movie.get("filmId") or movie.get("id")
        if not movie_id:
            return movie
        override = self.get(int(movie_id))
        if not override:
            return movie
        result = copy.deepcopy(movie)
        for key, value in override.items():
            if key in {"trailerUrl", "trailerName"}:
                continue  # обрабатываются отдельно в get_movie_videos
            if value is None:
                continue
            result[key] = value
        return result

    def apply_to_list(self, movies: List[dict]) -> List[dict]:
        return [self.apply_to_movie(m) for m in movies]

    # ------------------------------------------------------------------
    def update(self, movie_id: int, fields: Dict[str, Any], *,
               admin_email: str = "", snapshot: Optional[dict] = None) -> Dict[str, Any]:
        """Сохраняет правки поверх текущих (merge). Пустые значения снимают
        override для конкретного поля. Пишет запись в историю."""
        key = str(int(movie_id))
        clean = _sanitize(fields)
        with self._lock:
            before = copy.deepcopy(self._data.get(key, {}))
            current = dict(before)
            for f, v in clean.items():
                if v is None:
                    current.pop(f, None)
                else:
                    current[f] = v
            if current:
                self._data[key] = current
            else:
                self._data.pop(key, None)
            self._save(self._path, self._data)
            self._append_history({
                "id": uuid.uuid4().hex,
                "movieId": int(movie_id),
                "timestamp": _now_ms(),
                "adminEmail": admin_email or "",
                "before": before,
                "after": copy.deepcopy(current),
                "snapshot": snapshot or None,
            })
            return copy.deepcopy(current)

    def revert_to(self, movie_id: int, version_id: str, *, admin_email: str = "") -> Optional[Dict[str, Any]]:
        """Откат: устанавливает состояние `after` из указанной версии."""
        key = str(int(movie_id))
        with self._lock:
            target = next((h for h in self._history if h["id"] == version_id and h.get("movieId") == int(movie_id)), None)
            if not target:
                return None
            before = copy.deepcopy(self._data.get(key, {}))
            new_state = copy.deepcopy(target.get("after") or {})
            if new_state:
                self._data[key] = new_state
            else:
                self._data.pop(key, None)
            self._save(self._path, self._data)
            self._append_history({
                "id": uuid.uuid4().hex,
                "movieId": int(movie_id),
                "timestamp": _now_ms(),
                "adminEmail": admin_email or "",
                "before": before,
                "after": copy.deepcopy(new_state),
                "reverted_from": version_id,
            })
            return copy.deepcopy(new_state)

    def clear(self, movie_id: int, *, admin_email: str = "") -> Dict[str, Any]:
        return self.update(movie_id, {f: None for f in ALLOWED_FIELDS}, admin_email=admin_email)

    # ------------------------------------------------------------------
    def history_for(self, movie_id: int, limit: int = 50) -> List[dict]:
        with self._lock:
            items = [h for h in self._history if h.get("movieId") == int(movie_id)]
            items.sort(key=lambda h: h.get("timestamp", 0), reverse=True)
            return copy.deepcopy(items[:limit])

    def all(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._data)

    def _append_history(self, entry: dict) -> None:
        self._history.append(entry)
        # Обрезаем историю до MAX_HISTORY * <число фильмов с правками>, но
        # проще — просто ограничиваем общее число записей.
        if len(self._history) > MAX_HISTORY * 10:
            self._history = self._history[-MAX_HISTORY * 10:]
        self._save(self._history_path, self._history)
