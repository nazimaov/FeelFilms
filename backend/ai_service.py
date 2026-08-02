"""Модульный ИИ-ассистент поиска фильмов для FeelFilm.

Помогает найти фильм/сериал по описанию сцены, сюжета, персонажей, диалогов
или обрывочных воспоминаний. ИИ не хранит собственную базу фильмов: он лишь
предлагает названия, а реальные карточки (постер, год, рейтинг) подбирает
FeelFilm из своего каталога/поиска.

Архитектура модульная: провайдер задаётся через окружение. На первом этапе —
Groq (OpenAI-совместимый API). Чтобы заменить провайдера, достаточно поменять
переменные окружения (base_url/key/model) или добавить новый класс-провайдер,
не меняя остальную логику приложения.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import List, Optional

import requests

logger = logging.getLogger("feelfilms.ai")

SYSTEM_PROMPT = (
    "Ты — ассистент приложения FeelFilm. Помогаешь пользователю вспомнить и найти "
    "фильм или сериал по описанию сцены, сюжета, персонажей, диалогов или любых "
    "обрывочных воспоминаний.\n"
    "Проанализируй сообщение пользователя и историю диалога.\n"
    "- Если информации явно недостаточно, чтобы предположить конкретные фильмы, "
    "задай ОДИН короткий уточняющий вопрос.\n"
    "- Иначе предложи от 3 до 5 наиболее подходящих фильмов или сериалов.\n"
    "Отвечай СТРОГО в формате JSON без пояснений вокруг:\n"
    '{"reply": "<короткий дружелюбный текст на русском>", '
    '"need_more_info": <true|false>, '
    '"movies": [{"title": "<название>", "year": <год числом или null>}]}\n'
    "Если задаёшь уточняющий вопрос — need_more_info=true и movies=[].\n"
    "Если предлагаешь фильмы — need_more_info=false, заполни movies, а в reply дай "
    "короткое вступление, например «Похоже, это может быть одно из этих:».\n"
    "В title указывай общеизвестное название фильма (оригинальное или русское) и по "
    "возможности год. Не выдумывай несуществующие фильмы."
)


class AIProvider:
    """Базовый интерфейс провайдера ИИ (chat completion)."""

    @property
    def enabled(self) -> bool:
        raise NotImplementedError

    def chat_json(self, messages: List[dict]) -> Optional[dict]:
        raise NotImplementedError


class OpenAICompatibleProvider(AIProvider):
    """Провайдер для любого OpenAI-совместимого API (Groq, OpenAI, и т.п.)."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        session: Optional[requests.Session] = None,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._session = session or requests.Session()
        self._timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    def chat_json(self, messages: List[dict]) -> Optional[dict]:
        if not self._api_key:
            return None
        payload = {
            "model": self._model,
            "messages": messages,
            "temperature": 0.6,
            "max_tokens": 900,
            "response_format": {"type": "json_object"},
        }
        try:
            resp = self._session.post(
                f"{self._base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("AI provider request failed: %s", exc)
            return None

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            logger.warning("AI provider returned unexpected shape: %s", str(data)[:300])
            return None

        return _parse_ai_json(content)


def _parse_ai_json(content: str) -> Optional[dict]:
    """Достаёт JSON из ответа модели (даже если он обёрнут в текст/```json)."""
    if not content:
        return None
    text = content.strip()
    # Срезаем возможные ```json ... ``` ограждения.
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S | re.I)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except ValueError:
        pass
    # Последняя попытка — вырезать первый {...} блок.
    brace = re.search(r"\{.*\}", text, re.S)
    if brace:
        try:
            return json.loads(brace.group(0))
        except ValueError:
            return None
    return None


class AIAssistant:
    """Высокоуровневый ассистент: формирует диалог и возвращает намерение
    (уточняющий вопрос или список названий фильмов)."""

    MAX_HISTORY = 12  # сколько последних сообщений диалога передаём модели

    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    @property
    def enabled(self) -> bool:
        return self._provider.enabled

    def assist(self, history: List[dict]) -> Optional[dict]:
        """history — список {"role": "user"|"assistant", "content": str}.

        Возвращает {"reply": str, "need_more_info": bool,
        "movies": [{"title": str, "year": int|None}]} или None при ошибке.
        """
        clean: List[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        for msg in history[-self.MAX_HISTORY:]:
            role = msg.get("role")
            content = (msg.get("content") or "").strip()
            if role in {"user", "assistant"} and content:
                clean.append({"role": role, "content": content[:2000]})

        if len(clean) == 1:  # нет ни одного пользовательского сообщения
            return None

        result = self._provider.chat_json(clean)
        if not isinstance(result, dict):
            return None

        movies_raw = result.get("movies")
        movies: List[dict] = []
        if isinstance(movies_raw, list):
            for item in movies_raw[:5]:
                if not isinstance(item, dict):
                    continue
                title = (item.get("title") or "").strip()
                if not title:
                    continue
                year = item.get("year")
                if not isinstance(year, int):
                    try:
                        year = int(str(year)[:4])
                    except (TypeError, ValueError):
                        year = None
                movies.append({"title": title, "year": year})

        return {
            "reply": (result.get("reply") or "").strip(),
            "need_more_info": bool(result.get("need_more_info")) and not movies,
            "movies": movies,
        }


def build_ai_assistant(session: Optional[requests.Session] = None) -> AIAssistant:
    """Собирает ассистента по переменным окружения. По умолчанию — Groq."""
    provider_name = os.getenv("AI_PROVIDER", "groq").strip().lower()

    # Пока поддерживаем OpenAI-совместимые провайдеры (Groq и др.).
    if provider_name in {"groq", "openai", "openai_compatible"}:
        if provider_name == "groq":
            api_key = os.getenv("GROQ_API_KEY", "").strip()
            base_url = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").strip()
            model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
        else:
            api_key = os.getenv("AI_API_KEY", "").strip()
            base_url = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").strip()
            model = os.getenv("AI_MODEL", "gpt-4o-mini").strip()
        provider = OpenAICompatibleProvider(
            api_key=api_key, base_url=base_url, model=model, session=session
        )
    else:
        logger.warning("Unknown AI_PROVIDER=%r, AI assistant disabled.", provider_name)
        provider = OpenAICompatibleProvider(api_key="", base_url="", model="", session=session)

    return AIAssistant(provider)
