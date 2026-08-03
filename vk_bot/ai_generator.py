"""Генерация текста поста.

По ТЗ пост состоит из: привлекательного заголовка, краткого описания без
спойлеров, основных сведений о фильме и вопроса для вовлечения аудитории.

Две реализации:
- :class:`OpenAICompatibleGenerator` — обращается к OpenAI-совместимому API
  (OpenAI, OpenRouter, GigaChat через прокси, локальный Ollama и т. п.).
- :class:`TemplateGenerator` — шаблонная генерация без ИИ. Работает всегда,
  используется как запасной вариант, если ИИ недоступен или не настроен.
"""

from __future__ import annotations

import abc
import json
from typing import Optional

import requests

from .logger import get_logger
from .news_fetcher import NewsItem

logger = get_logger("ai_generator")


def _facts_line(item: NewsItem) -> str:
    """Строка с основными сведениями о фильме."""
    parts = []
    if item.year:
        parts.append(str(item.year))
    if item.countries:
        parts.append(", ".join(item.countries[:2]))
    if item.genres:
        parts.append(", ".join(item.genres[:3]))
    if item.rating:
        parts.append(f"рейтинг {item.rating:.1f}")
    return " • ".join(parts)


class TextGenerator(abc.ABC):
    @abc.abstractmethod
    def generate(self, item: NewsItem, hashtags: str = "", cta: str = "") -> str:
        raise NotImplementedError


class TemplateGenerator(TextGenerator):
    """Собирает аккуратный пост из полей материала — без обращения к ИИ."""

    _KIND_WORD = {"film": "Фильм", "series": "Сериал"}

    _QUESTIONS = [
        "А вы уже смотрели? Делитесь впечатлениями в комментариях!",
        "Добавите в список к просмотру? 🍿",
        "Как вам идея? Ждём ваше мнение ниже 👇",
        "Стоит смотреть или пропустить? Голосуем в комментариях!",
    ]

    def generate(self, item: NewsItem, hashtags: str = "", cta: str = "") -> str:
        import random

        kind = self._KIND_WORD.get(item.kind, "Кино")
        title_line = f"🎬 {item.title}"
        if item.original_title and item.original_title.lower() != item.title.lower():
            title_line += f" ({item.original_title})"

        lines = [title_line, ""]

        facts = _facts_line(item)
        if facts:
            lines.append(f"📌 {kind}: {facts}")

        if item.content_type and item.content_type.key == "premiere" and item.premiere_date:
            lines.append(f"📅 Премьера: {item.premiere_date}")

        if item.description:
            # Обрезаем слишком длинное описание, чтобы пост не был громоздким.
            desc = item.description.strip()
            if len(desc) > 500:
                desc = desc[:497].rstrip() + "…"
            lines.append("")
            lines.append(desc)

        if item.trailer_url:
            lines.append("")
            lines.append(f"▶️ Трейлер: {item.trailer_url}")

        lines.append("")
        lines.append(random.choice(self._QUESTIONS))

        if cta:
            lines.append("")
            lines.append(cta)

        if hashtags:
            lines.append("")
            lines.append(hashtags)

        return "\n".join(lines)


class OpenAICompatibleGenerator(TextGenerator):
    """Генерация через chat-completions API, совместимый с OpenAI."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        temperature: float = 0.8,
        timeout: float = 40.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._temperature = temperature
        self._timeout = timeout
        self._fallback = TemplateGenerator()

    _SYSTEM_PROMPT = (
        "Ты — SMM-редактор сообщества о кино «FeelFilm» во ВКонтакте. "
        "Пишешь живые, тёплые и грамотные посты на русском языке. "
        "Без спойлеров, без выдуманных фактов, без канцелярита. "
        "Уместные эмодзи приветствуются, но в меру."
    )

    def _build_user_prompt(self, item: NewsItem) -> str:
        intent = item.content_type.intent if item.content_type else ""
        facts = _facts_line(item)
        return (
            f"Задача: {intent}\n\n"
            f"Данные о материале (используй только их, ничего не выдумывай):\n"
            f"- Название: {item.title}\n"
            f"- Оригинальное название: {item.original_title or '—'}\n"
            f"- Тип: {'сериал' if item.kind == 'series' else 'фильм'}\n"
            f"- Основные сведения: {facts or '—'}\n"
            f"- Дата премьеры: {item.premiere_date or '—'}\n"
            f"- Описание-источник: {item.description or '—'}\n\n"
            "Верни СТРОГО JSON без пояснений и markdown, по схеме:\n"
            '{"title": "цепляющий заголовок", '
            '"body": "2-4 предложения: краткое описание без спойлеров + чем интересно", '
            '"question": "короткий вопрос для вовлечения аудитории"}'
        )

    def _parse_json(self, content: str) -> Optional[dict]:
        content = content.strip()
        # Иногда модель оборачивает ответ в ```json ... ```
        if content.startswith("```"):
            content = content.strip("`")
            if content.lower().startswith("json"):
                content = content[4:]
        # Берём фрагмент от первой { до последней }
        start, end = content.find("{"), content.rfind("}")
        if start == -1 or end == -1:
            return None
        try:
            return json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            return None

    def generate(self, item: NewsItem, hashtags: str = "", cta: str = "") -> str:
        payload = {
            "model": self._model,
            "temperature": self._temperature,
            "messages": [
                {"role": "system", "content": self._SYSTEM_PROMPT},
                {"role": "user", "content": self._build_user_prompt(item)},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            resp = requests.post(
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
        except (requests.RequestException, KeyError, ValueError, IndexError) as exc:
            logger.warning("ИИ недоступен (%s). Использую шаблонную генерацию.", exc)
            return self._fallback.generate(item, hashtags, cta)

        parsed = self._parse_json(content)
        if not parsed:
            logger.warning("ИИ вернул неразборчивый ответ. Использую шаблонную генерацию.")
            return self._fallback.generate(item, hashtags, cta)

        return self._assemble(item, parsed, hashtags, cta)

    def _assemble(self, item: NewsItem, parsed: dict, hashtags: str, cta: str = "") -> str:
        title = (parsed.get("title") or item.title).strip()
        body = (parsed.get("body") or item.description).strip()
        question = (parsed.get("question") or "А что думаете вы? Пишите в комментариях!").strip()

        lines = [f"🎬 {title}", ""]

        facts = _facts_line(item)
        if facts:
            lines.append(f"📌 {facts}")
        if item.content_type and item.content_type.key == "premiere" and item.premiere_date:
            lines.append(f"📅 Премьера: {item.premiere_date}")
        if facts or item.premiere_date:
            lines.append("")

        lines.append(body)

        if item.trailer_url:
            lines.append("")
            lines.append(f"▶️ Трейлер: {item.trailer_url}")

        lines.append("")
        lines.append(question)

        if cta:
            lines.append("")
            lines.append(cta)

        if hashtags:
            lines.append("")
            lines.append(hashtags)

        return "\n".join(lines)


def build_generator(
    provider: str,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float,
) -> TextGenerator:
    """Фабрика генератора по значению ``AI_PROVIDER`` из конфига."""
    if provider == "openai" and api_key:
        logger.info("ИИ-генерация: OpenAI-совместимый API, модель %s", model)
        return OpenAICompatibleGenerator(api_key, base_url, model, temperature)
    logger.info("ИИ-генерация: шаблонный режим (без внешнего ИИ).")
    return TemplateGenerator()
