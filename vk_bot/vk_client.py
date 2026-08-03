"""Клиент VK API: публикация записей на стену сообщества и загрузка фото.

Используется токен сообщества (community access token) с правами
``wall`` и ``photos``. Публикация идёт от имени сообщества
(``from_group=1``, ``owner_id = -group_id``).

Документация методов:
- wall.post ........................ публикация записи
- photos.getWallUploadServer ....... получить URL сервера загрузки
- photos.saveWallPhoto ............. сохранить загруженное фото
"""

from __future__ import annotations

from typing import List, Optional

import requests

from .logger import get_logger

logger = get_logger("vk_client")

VK_API_URL = "https://api.vk.com/method"


class VKError(Exception):
    """Ошибка, возвращённая VK API (поле ``error`` в ответе)."""

    def __init__(self, code: int, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"VK API error {code}: {message}")


class VKClient:
    def __init__(
        self,
        token: str,
        group_id: int,
        api_version: str = "5.199",
        timeout: float = 20.0,
    ) -> None:
        self._token = token
        self._group_id = abs(group_id)
        self._owner_id = -abs(group_id)
        self._version = api_version
        self._timeout = timeout
        self._session = requests.Session()

    # ------------------------------------------------------------------
    # Низкоуровневый вызов метода API
    # ------------------------------------------------------------------
    def _call(self, method: str, params: dict) -> dict:
        payload = {
            "access_token": self._token,
            "v": self._version,
            **params,
        }
        try:
            resp = self._session.post(
                f"{VK_API_URL}/{method}",
                data=payload,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            raise VKError(-1, f"Сетевая ошибка при вызове {method}: {exc}") from exc
        except ValueError as exc:
            raise VKError(-1, f"Некорректный JSON от VK при вызове {method}: {exc}") from exc

        if "error" in data:
            err = data["error"]
            raise VKError(
                int(err.get("error_code", 0)),
                str(err.get("error_msg", "unknown error")),
            )
        return data.get("response", {})

    # ------------------------------------------------------------------
    # Загрузка фото на стену
    # ------------------------------------------------------------------
    def upload_wall_photo(self, image_bytes: bytes, filename: str = "poster.jpg") -> str:
        """Загружает изображение и возвращает attachment-строку ``photo{owner}_{id}``.

        Три шага по протоколу VK: получить сервер → залить файл → сохранить.
        """
        # 1. Сервер загрузки для стены сообщества.
        upload = self._call("photos.getWallUploadServer", {"group_id": self._group_id})
        upload_url = upload["upload_url"]

        # 2. Заливаем файл multipart-запросом.
        try:
            up_resp = self._session.post(
                upload_url,
                files={"photo": (filename, image_bytes, "image/jpeg")},
                timeout=self._timeout,
            )
            up_resp.raise_for_status()
            up_data = up_resp.json()
        except requests.RequestException as exc:
            raise VKError(-1, f"Ошибка загрузки фото на сервер VK: {exc}") from exc
        except ValueError as exc:
            raise VKError(-1, f"Некорректный ответ сервера загрузки VK: {exc}") from exc

        if not up_data.get("photo") or up_data.get("photo") == "[]":
            raise VKError(-1, "VK не принял изображение (пустой ответ сервера загрузки).")

        # 3. Сохраняем фото в сообществе.
        saved = self._call(
            "photos.saveWallPhoto",
            {
                "group_id": self._group_id,
                "photo": up_data["photo"],
                "server": up_data["server"],
                "hash": up_data["hash"],
            },
        )
        if not saved:
            raise VKError(-1, "photos.saveWallPhoto вернул пустой ответ.")

        photo = saved[0]
        return f"photo{photo['owner_id']}_{photo['id']}"

    # ------------------------------------------------------------------
    # Публикация записи
    # ------------------------------------------------------------------
    def post_to_wall(
        self,
        message: str,
        attachments: Optional[List[str]] = None,
    ) -> int:
        """Публикует запись на стену сообщества. Возвращает ID поста."""
        params = {
            "owner_id": self._owner_id,
            "from_group": 1,
            "message": message,
        }
        if attachments:
            params["attachments"] = ",".join(attachments)

        response = self._call("wall.post", params)
        post_id = int(response.get("post_id", 0))
        logger.info("Опубликован пост id=%s на стене сообщества %s", post_id, self._group_id)
        return post_id

    # ------------------------------------------------------------------
    # Поиск видео-трейлера в VK
    # ------------------------------------------------------------------
    def search_video(
        self,
        query: str,
        min_duration: int = 20,
        max_duration: int = 900,
    ) -> Optional[str]:
        """Ищет видео в VK по запросу и возвращает attachment ``video{owner}_{id}``.

        Отсекает слишком короткие и слишком длинные ролики (чтобы не прицепить
        полный фильм вместо трейлера). Возвращает ``None``, если ничего
        подходящего не нашлось. Требует пользовательский токен с правом video —
        групповой токен этот метод не поддерживает.
        """
        try:
            response = self._call(
                "video.search",
                {"q": query, "count": 15, "adult": 0, "sort": 2, "hd": 1},
            )
        except VKError as exc:
            logger.warning("Поиск видео не удался (%s): %s", query, exc)
            return None

        for item in response.get("items", []):
            owner_id = item.get("owner_id")
            video_id = item.get("id")
            if owner_id is None or video_id is None:
                continue
            duration = item.get("duration") or 0
            # 0 = прямой эфир/неизвестно — пропускаем во избежание сюрпризов.
            if duration and not (min_duration <= duration <= max_duration):
                continue
            attachment = f"video{owner_id}_{video_id}"
            access_key = item.get("access_key")
            if access_key:
                attachment += f"_{access_key}"
            logger.info("Найден трейлер в VK: «%s» (%s)", (item.get("title") or "")[:60], attachment)
            return attachment

        logger.info("Подходящего видео в VK не найдено по запросу: %s", query)
        return None

    def check_token(self) -> Optional[str]:
        """Быстрая проверка токена: возвращает имя сообщества или None."""
        try:
            groups = self._call("groups.getById", {"group_id": self._group_id})
            # В разных версиях API форма ответа отличается.
            if isinstance(groups, dict) and groups.get("groups"):
                return groups["groups"][0].get("name")
            if isinstance(groups, list) and groups:
                return groups[0].get("name")
        except VKError as exc:
            logger.warning("Проверка токена не удалась: %s", exc)
        return None
