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
    "обрывочных воспоминаний.\n\n"
    "ПРАВИЛА:\n"
    "1. Предлагай ТОЛЬКО реально существующие фильмы, которые ты знаешь достоверно. "
    "Если сомневаешься — лучше предложи меньше вариантов. НЕ ВЫДУМЫВАЙ.\n"
    "2. Уточняющий вопрос можно задать МАКСИМУМ ОДИН РАЗ за диалог, и только если "
    "запрос совсем общий. Если ты уже задавал уточнение раньше в этом диалоге — "
    "больше НЕ спрашивай, а сразу дай свои лучшие догадки (пусть даже неуверенные).\n"
    "3. Предлагай 1–5 фильмов или сериалов (лучше 1–3 точных, чем 5 мусорных). "
    "Учитывай все сообщения пользователя вместе — имена персонажей, страны, "
    "фрагменты сцен из разных сообщений складываются в одно описание.\n"
    "4. Для каждого фильма ОБЯЗАТЕЛЬНО указывай оригинальное название (title) — "
    "именно то, под которым фильм известен на Кинопоиске / IMDB (можно на русском "
    "или на языке оригинала — используй то, что чаще встречается на Кинопоиске). "
    "Также указывай год.\n\n"
    "Отвечай СТРОГО в формате JSON без пояснений вокруг:\n"
    '{"reply": "<короткий дружелюбный текст на русском>", '
    '"need_more_info": <true|false>, '
    '"movies": [{"title": "<точное название>", "year": <год числом или null>}]}\n\n'
    "Если задаёшь уточняющий вопрос — need_more_info=true и movies=[].\n"
    "Иначе — need_more_info=false, reply короткое, например «Похоже, это может "
    "быть одно из этих:» или «Возможно, вы имели в виду:».\n"
    "Если ничего не приходит на ум даже как догадка — верни пустой movies и в "
    "reply честно скажи, что не узнал."
)


class AIProvider:
    """Базовый интерфейс провайдера ИИ (chat completion)."""

    @property
    def enabled(self) -> bool:
        raise NotImplementedError

    def chat_json(self, messages: List[dict], prefer_strong: bool = False) -> Optional[dict]:
        raise NotImplementedError


class OpenAICompatibleProvider(AIProvider):
    """Провайдер для любого OpenAI-совместимого API (Groq, OpenAI, и т.п.).

    Поддерживает список моделей через запятую (``models`` или строка): пробует
    их по порядку — на 429/сетевой ошибке / отсутствии полезного ответа
    переходит к следующей. Так основная сильная модель может «падать» на
    rate-limit, а более простая — подхватывать.
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        session: Optional[requests.Session] = None,
        timeout: float = 60.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._models: List[str] = [m.strip() for m in (model or "").split(",") if m.strip()]
        self._session = session or requests.Session()
        self._timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self._api_key) and bool(self._models)

    def _call_model(self, model: str, messages: List[dict]) -> Optional[dict]:
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 900,
        }
        # compound-модели у Groq не поддерживают response_format=json_object,
        # но хорошо следуют инструкции про JSON в system-промпте.
        if not model.startswith("groq/compound"):
            payload["response_format"] = {"type": "json_object"}
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
        except requests.RequestException as exc:
            logger.warning("AI request to %s failed: %s", model, exc)
            return None

        if resp.status_code == 429:
            logger.info("AI model %s rate-limited (429), trying next.", model)
            return None
        if resp.status_code >= 400:
            logger.warning("AI model %s HTTP %s: %s", model, resp.status_code, resp.text[:200])
            return None

        try:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            logger.warning("AI model %s bad response: %s", model, exc)
            return None

        return _parse_ai_json(content)

    def chat_json(self, messages: List[dict], prefer_strong: bool = False) -> Optional[dict]:
        """Пробует модели по цепочке. Если prefer_strong=True (сложный запрос,
        пользователь уже уточнял) — сначала пытается модели с веб-поиском
        (compound), у них лучше знание нишевых/недавних фильмов."""
        if not self.enabled:
            return None
        order = list(self._models)
        if prefer_strong:
            strong = [m for m in order if "compound" in m.lower()]
            weak = [m for m in order if "compound" not in m.lower()]
            order = strong + weak
        for model in order:
            result = self._call_model(model, messages)
            if result is not None:
                return result
        return None


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
        user_msgs = 0
        for msg in history[-self.MAX_HISTORY:]:
            role = msg.get("role")
            content = (msg.get("content") or "").strip()
            if role in {"user", "assistant"} and content:
                clean.append({"role": role, "content": content[:2000]})
                if role == "user":
                    user_msgs += 1

        if len(clean) == 1:  # нет ни одного пользовательского сообщения
            return None

        # Если пользователь уже писал >1 раза (значит первый ответ его не устроил
        # или мы уточняли), запрещаем модели снова спрашивать и просим
        # обязательно предложить фильмы.
        if user_msgs >= 2:
            clean.append({
                "role": "system",
                "content": (
                    "Пользователь уже добавил детали. НЕ задавай больше уточняющих "
                    "вопросов. Дай свои лучшие догадки в movies — 1–5 реально "
                    "существующих фильмов/сериалов, даже если ты не на 100% уверен. "
                    "need_more_info должно быть false."
                ),
            })

        result = self._provider.chat_json(clean, prefer_strong=(user_msgs >= 2))
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
            # По умолчанию — цепочка: сначала compound (веб-поиск, лучшие ответы,
            # но строгий rate-limit), при отказе — gpt-oss-120b (сильная модель,
            # без rate-limit), последний фолбэк — llama-3.3-70b (всегда доступна).
            model = os.getenv(
                "GROQ_MODEL",
                "groq/compound,openai/gpt-oss-120b,llama-3.3-70b-versatile",
            ).strip()
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
