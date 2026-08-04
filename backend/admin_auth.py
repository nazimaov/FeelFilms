"""Проверка Firebase ID Token без Firebase Admin SDK.

Идея: клиент админ-панели после успешного Firebase-логина берёт свой ID
Token (`user.getIdToken()`) и шлёт его в заголовке ``Authorization: Bearer``.
Бэкенд проверяет токен через публичный метод Google ``accounts:lookup``.
Google подтверждает валидность (подпись, срок, project) и возвращает email —
мы сверяем его с whitelist. Никаких секретов на сервере хранить не нужно.

Результат кэшируется на минуту, чтобы не гонять Google на каждый запрос.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional, Set

import requests
from fastapi import HTTPException, Request

logger = logging.getLogger("feelfilms.admin_auth")

FIREBASE_API_KEY = os.getenv("FIREBASE_WEB_API_KEY", "AIzaSyDHa1gPxZyYPNEcE69BZF9fqogOtMvofhk").strip()
ADMIN_EMAILS: Set[str] = {
    e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "nazimaov2@gmail.com").split(",") if e.strip()
}

_CACHE_TTL_SECONDS = 60
_cache: dict = {}
_cache_lock = threading.Lock()


def _verify_with_google(id_token: str) -> Optional[str]:
    """Возвращает email пользователя, если токен валидный. Иначе None."""
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}"
    try:
        resp = requests.post(url, json={"idToken": id_token}, timeout=10)
    except requests.RequestException as exc:
        logger.warning("Firebase lookup network error: %s", exc)
        return None
    if resp.status_code != 200:
        return None
    try:
        users = resp.json().get("users") or []
    except ValueError:
        return None
    if not users:
        return None
    email = (users[0].get("email") or "").strip().lower()
    return email or None


def _cached_email(id_token: str) -> Optional[str]:
    now = time.time()
    with _cache_lock:
        entry = _cache.get(id_token)
        if entry and entry["exp"] > now:
            return entry["email"]
    email = _verify_with_google(id_token)
    with _cache_lock:
        # Ограничим размер кэша — на всякий случай.
        if len(_cache) > 500:
            _cache.clear()
        _cache[id_token] = {"email": email, "exp": now + _CACHE_TTL_SECONDS}
    return email


def require_admin(request: Request) -> str:
    """FastAPI dependency: пускает только админа. Возвращает его email."""
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")
    email = _cached_email(token)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if email.lower() not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Not an admin")
    return email
