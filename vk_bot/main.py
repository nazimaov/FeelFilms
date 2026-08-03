"""Точка входа бота FeelFilm для ВКонтакте.

Запуск:
    python -m vk_bot.main               # по расписанию (демон)
    python -m vk_bot.main --once        # одна публикация прямо сейчас
    python -m vk_bot.main --once --dry-run   # прогон без реальной публикации
    python -m vk_bot.main --check       # проверить конфигурацию и токен

Пайплайн одной публикации:
    выбрать тип контента → найти свежий материал → сгенерировать текст ИИ →
    скачать постер → загрузить во ВКонтакте → опубликовать → отметить в журнале.
"""

from __future__ import annotations

import argparse
import sys

from . import content_types
from .ai_generator import build_generator
from .config import load_config, validate_config
from .image_handler import ImageHandler
from .logger import setup_logging
from .news_fetcher import KinopoiskSource, NewsFetcher
from .posted_store import PostedStore
from .scheduler import Scheduler
from .trailer_search import RutubeTrailerSearch
from .vk_client import VKClient, VKError


class Bot:
    """Связывает все модули и умеет публиковать один пост."""

    def __init__(self, cfg) -> None:
        self.cfg = cfg
        self.log = setup_logging(cfg.log_file, cfg.log_level)

        self.store = PostedStore(cfg.posted_store_path)
        self.fetcher = NewsFetcher(
            sources=[
                KinopoiskSource(
                    api_key=cfg.kinopoisk_api_key,
                    api_base=cfg.kinopoisk_api_base,
                    timeout=cfg.request_timeout,
                ),
            ],
            store=self.store,
            min_rating=cfg.min_rating,
        )
        self.generator = build_generator(
            provider=cfg.ai_provider,
            api_key=cfg.ai_api_key,
            base_url=cfg.ai_base_url,
            model=cfg.ai_model,
            temperature=cfg.ai_temperature,
        )
        self.images = ImageHandler(timeout=cfg.request_timeout)
        self.trailer = RutubeTrailerSearch(timeout=cfg.request_timeout)
        self.vk = VKClient(
            token=cfg.vk_token,
            group_id=cfg.vk_group_id,
            api_version=cfg.vk_api_version,
            timeout=cfg.request_timeout,
        )
        self.enabled_types = content_types.resolve_enabled(cfg.content_types)

    def publish_once(self, dry_run: bool = False) -> bool:
        """Готовит и публикует один пост. Возвращает True при успехе."""
        # Счётчик берём из хранилища — так чередование типов контента
        # сохраняется между отдельными запусками (cron / GitHub Actions).
        counter = self.store.next_counter()
        content_type = content_types.pick(self.enabled_types, counter)
        self.log.info("=== Публикация #%d, тип контента: %s ===", counter + 1, content_type.label)

        item = self.fetcher.next_item(content_type)
        if item is None:
            self.log.warning("Нет свежего материала — публикация пропущена.")
            return False

        # --- Трейлер ---
        # Ищем ролик на RuTube (публичный API, без токена, играется в РФ).
        # Ссылка идёт в текст поста — VK превращает её в превью-карточку с
        # плеером. Прикрепить встроенное VK-видео как attachment нельзя:
        # video.search и video.save недоступны с group-токеном.
        item.trailer_url = ""
        if self.cfg.attach_trailer_link:
            item.trailer_url = self.trailer.search(item.title, item.year) or ""

        message = self.generator.generate(item, hashtags=self.cfg.hashtags, cta=self.cfg.cta)

        image_bytes = self.images.download(item.poster_url)

        if dry_run:
            self.log.info("[DRY-RUN] Пост НЕ будет опубликован. Текст:\n%s", message)
            self.log.info(
                "[DRY-RUN] Постер: %s (%s) | RuTube-трейлер: %s",
                "есть" if image_bytes else "нет",
                item.poster_url or "—",
                item.trailer_url or "нет",
            )
            return True

        attachments = []

        # Загружаем постер (если удалось скачать). Пост без картинки всё равно уходит.
        # NB: photos.getWallUploadServer недоступен group-токену — при таком
        # токене шаг молча упадёт, пост уйдёт без постера.
        if image_bytes:
            try:
                attachments.append(self.vk.upload_wall_photo(image_bytes))
            except VKError as exc:
                self.log.warning("Не удалось прикрепить постер: %s. Публикую без него.", exc)

        try:
            post_id = self.vk.post_to_wall(message, attachments=attachments)
        except VKError as exc:
            self.log.error("Публикация не удалась: %s", exc)
            return False

        # Отмечаем материал как опубликованный только после успешного поста.
        self.store.mark_posted(item.key, {"title": item.title, "post_id": post_id, "type": content_type.key})
        self.log.info("Готово. Пост #%s: «%s»", post_id, item.title)
        return True


def _check(cfg, bot: Bot) -> int:
    """Диагностика конфигурации и токена."""
    problems = validate_config(cfg)
    if problems:
        for p in problems:
            bot.log.error("Проблема конфигурации: %s", p)
        return 1
    name = bot.vk.check_token()
    if name:
        bot.log.info("Токен рабочий. Сообщество: «%s». В журнале уже %d публикаций.", name, len(bot.store))
        return 0
    bot.log.error("Токен не прошёл проверку. Проверьте VK_TOKEN и права сообщества.")
    return 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Бот автопостинга FeelFilm для ВКонтакте")
    parser.add_argument("--once", action="store_true", help="опубликовать один пост и выйти")
    parser.add_argument("--dry-run", action="store_true", help="не публиковать, только показать текст")
    parser.add_argument("--check", action="store_true", help="проверить конфигурацию и токен")
    args = parser.parse_args(argv)

    cfg = load_config()
    bot = Bot(cfg)

    if args.check:
        return _check(cfg, bot)

    # Перед реальной работой убеждаемся, что конфиг валиден (в dry-run послабляем).
    problems = validate_config(cfg)
    if problems and not args.dry_run:
        for p in problems:
            bot.log.error("Проблема конфигурации: %s", p)
        bot.log.error("Исправьте .env и повторите запуск (см. .env.example).")
        return 1

    if args.once:
        ok = bot.publish_once(dry_run=args.dry_run)
        return 0 if ok else 1

    # Демон по расписанию.
    if cfg.post_on_start:
        bot.publish_once(dry_run=args.dry_run)

    scheduler = Scheduler(
        mode=cfg.schedule_mode,
        post_times=cfg.post_times,
        interval_hours=cfg.interval_hours,
        timezone=cfg.timezone,
    )
    try:
        scheduler.run(lambda: bot.publish_once(dry_run=args.dry_run))
    except KeyboardInterrupt:
        bot.log.info("Остановлено пользователем. До встречи!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
