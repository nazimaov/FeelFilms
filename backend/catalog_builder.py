"""Сборщик локального каталога фильмов из kinopoisk.dev.

Зачем: раньше лента приложения ходила в Kinopoisk API вживую на каждого
пользователя — общий ключ упирался в суточный лимит («ошибка сервера»), а пул
популярного (~600 фильмов) быстро исчерпывался («фильмы закончились»).

Теперь backend один раз в сутки выкачивает большой разнообразный каталог
(тысячи фильмов и сериалов) в ``catalog.json`` и отдаёт ленту из него. Запуск
раз в сутки тратит ~30 запросов — суточного лимита kinopoisk.dev (200) хватает
с огромным запасом, а пользователи API вообще не трогают.

Формат каждого элемента приведён к тому виду, который уже понимает приложение
(поля как у kinopoiskapiunofficial: kinopoiskId, nameRu, posterUrl, genres[{genre}]
и т.д.) — так каталог работает как drop-in замена живого источника.

Запуск:
    python -m backend.catalog_builder            # собрать и записать catalog.json
    python backend/catalog_builder.py --limit 20 # ограничить число страниц (тест)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env", override=False, encoding="utf-8-sig")
except Exception:  # pragma: no cover
    pass

logger = logging.getLogger("feelfilms.catalog")

API_BASE = os.getenv("KINOPOISK_DEV_BASE", "https://api.kinopoisk.dev").rstrip("/")
TOKEN = (os.getenv("KINOPOISK_DEV_TOKEN") or "").strip()
CATALOG_PATH = Path(os.getenv("CATALOG_PATH", str(Path(__file__).parent / "catalog.json")))

PAGE_LIMIT = 250  # максимум отдачи kinopoisk.dev за один запрос

# Поля, которые запрашиваем у kinopoisk.dev.
SELECT_FIELDS = [
    "id", "name", "alternativeName", "year", "description", "shortDescription",
    "rating", "votes", "poster", "genres", "countries", "movieLength",
    "isSeries", "type", "ageRating", "watchability", "videos", "top250",
]


def _to_app_format(m: dict) -> Optional[dict]:
    """kinopoisk.dev → формат, который ожидает приложение (как kinopoiskapiunofficial)."""
    mid = m.get("id")
    if not mid:
        return None
    name = (m.get("name") or m.get("alternativeName") or "").strip()
    poster = m.get("poster") or {}
    poster_url = (poster.get("url") or "").strip()
    if not name or not poster_url:
        return None  # без названия или постера карточка не годится

    rating = m.get("rating") or {}
    votes = m.get("votes") or {}
    genres = [{"genre": g.get("name")} for g in (m.get("genres") or []) if g.get("name")]
    countries = [{"country": c.get("name")} for c in (m.get("countries") or []) if c.get("name")]
    is_series = bool(m.get("isSeries"))
    age = m.get("ageRating")

    watch_items = (m.get("watchability") or {}).get("items") or []
    watchability = [
        {"name": it.get("name"), "url": it.get("url"), "logo": (it.get("logo") or {}).get("url")}
        for it in watch_items if it.get("url") and it.get("name")
    ]
    trailers = [
        {"url": t.get("url"), "name": t.get("name"), "site": t.get("site")}
        for t in ((m.get("videos") or {}).get("trailers") or []) if t.get("url")
    ]

    return {
        "kinopoiskId": mid,
        "filmId": mid,
        "nameRu": m.get("name") or "",
        "nameEn": m.get("alternativeName") or "",
        "nameOriginal": m.get("alternativeName") or "",
        "posterUrl": poster_url,
        "posterUrlPreview": poster.get("previewUrl") or poster_url,
        "ratingKinopoisk": rating.get("kp"),
        "ratingImdb": rating.get("imdb"),
        "ratingVoteCount": votes.get("kp"),
        "ratingAgeLimits": (f"age{age}" if isinstance(age, int) and age else None),
        "year": m.get("year"),
        "description": (m.get("description") or m.get("shortDescription") or "").strip(),
        "shortDescription": (m.get("shortDescription") or "").strip(),
        "filmLength": m.get("movieLength"),
        "genres": genres,
        "countries": countries,
        "type": "TV_SERIES" if is_series else "FILM",
        "serial": is_series,
        # доп. данные для приложения (текущее приложение их игнорирует, но они есть)
        "watchability": watchability,
        "trailers": trailers,
        "top250": m.get("top250"),
    }


class CatalogBuilder:
    def __init__(self, token: str = TOKEN, api_base: str = API_BASE, timeout: float = 30.0) -> None:
        if not token:
            raise RuntimeError("KINOPOISK_DEV_TOKEN не задан — получите токен у @poiskkinodev_bot.")
        self._token = token
        self._api_base = api_base
        self._timeout = timeout
        self._session = requests.Session()

    def _fetch_page(self, page: int, extra_params: Optional[List[tuple]] = None) -> List[dict]:
        params: List[tuple] = [
            ("page", page),
            ("limit", PAGE_LIMIT),
            ("sortField", "votes.kp"),
            ("sortType", "-1"),
            ("notNullFields", "name"),
            ("notNullFields", "poster.url"),
        ]
        params += [("selectFields", f) for f in SELECT_FIELDS]
        if extra_params:
            params += extra_params
        resp = self._session.get(
            f"{self._api_base}/v1.4/movie",
            headers={"X-API-KEY": self._token},
            params=params,
            timeout=self._timeout,
        )
        resp.raise_for_status()
        return resp.json().get("docs") or []

    def _collect(self, label: str, pages: int, extra_params: List[tuple], into: Dict[int, dict]) -> None:
        for page in range(1, pages + 1):
            try:
                docs = self._fetch_page(page, extra_params)
            except requests.RequestException as exc:
                logger.warning("[%s] стр. %s — ошибка: %s", label, page, exc)
                break
            if not docs:
                break
            added = 0
            for raw in docs:
                item = _to_app_format(raw)
                if item and item["kinopoiskId"] not in into:
                    into[item["kinopoiskId"]] = item
                    added += 1
            logger.info("[%s] стр. %s/%s: +%d (всего %d)", label, page, pages, added, len(into))
            time.sleep(0.2)  # мягко к API

    def build(self, film_pages: int = 24, series_pages: int = 10, fresh_pages: int = 6) -> List[dict]:
        """Собирает разнообразный каталог: популярные фильмы, сериалы и свежие релизы."""
        collected: Dict[int, dict] = {}
        # Популярные фильмы (по числу голосов).
        self._collect("фильмы", film_pages, [("type", "movie")], collected)
        # Популярные сериалы.
        self._collect("сериалы", series_pages, [("type", "tv-series")], collected)
        # Свежие релизы последних лет — чтобы в ленте были новинки.
        self._collect("новинки", fresh_pages, [("type", "movie"), ("year", "2024-2026")], collected)
        return list(collected.values())

    def build_and_save(self, path: Path = CATALOG_PATH, **kwargs) -> int:
        items = self.build(**kwargs)
        payload = {
            "generated_at": int(time.time()),
            "count": len(items),
            "source": "kinopoisk.dev",
            "items": items,
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        tmp.replace(path)
        logger.info("Каталог сохранён: %s (%d фильмов)", path, len(items))
        return len(items)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Сборка каталога фильмов из kinopoisk.dev")
    parser.add_argument("--film-pages", type=int, default=24, help="страниц фильмов (×250)")
    parser.add_argument("--series-pages", type=int, default=10, help="страниц сериалов (×250)")
    parser.add_argument("--fresh-pages", type=int, default=6, help="страниц новинок (×250)")
    parser.add_argument("--out", default=str(CATALOG_PATH), help="путь к catalog.json")
    args = parser.parse_args()

    builder = CatalogBuilder()
    count = builder.build_and_save(
        Path(args.out),
        film_pages=args.film_pages,
        series_pages=args.series_pages,
        fresh_pages=args.fresh_pages,
    )
    print(f"Готово: {count} фильмов в каталоге -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
