# FeelFilm в Android Studio

## Что уже сделано
- Добавлен Android-проект (`app` модуль, Kotlin, WebView).
- Веб-файлы проекта скопированы в Android assets:
  - `app/src/main/assets/index.html`
  - `app/src/main/assets/styles.css`
  - `app/src/main/assets/app.js`
  - `app/src/main/assets/google-services.json`

## Как открыть
1. Откройте Android Studio.
2. Нажмите **Open** и выберите папку проекта:
   `c:\Users\Home\Documents\AI PROJECT\FeelFilms`
3. Дождитесь Gradle Sync.

## Как запустить на Android
1. Подключите устройство (USB debugging) или запустите эмулятор.
2. Выберите конфигурацию `app`.
3. Нажмите **Run**.

## Важно
- Приложение запускает ваш фронтенд через `WebView` (`file:///android_asset/index.html`).
- Если Firebase Auth в WebView не будет авторизовывать, добавьте разрешенный домен/подход для Android WebView в Firebase Console (или переходите на native Firebase SDK).
