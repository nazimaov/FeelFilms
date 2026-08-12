/* ==========================================================================
   FeelFilm — Android TV: управление пультом (D-pad)

   Модуль работает ПОВЕРХ существующего интерфейса и не меняет бизнес-логику
   приложения: он лишь переводит фокус между уже существующими элементами и
   вызывает их штатные обработчики через click(). Всё, что делает мобильная
   версия, на телевизоре делается теми же самыми кнопками.

   Подключается первым (в <head>), поэтому tv.css успевает загрузиться до
   первой отрисовки и на телевизоре не мелькает мобильная раскладка.
   ========================================================================== */

(function () {
    'use strict';

    // ======================================================================
    // Определение телевизора
    // ======================================================================

    /**
     * Телевизор определяется (в порядке надёжности):
     *   1. параметром ?tv=1 / ?tv=0 в URL — его выставляет MainActivity;
     *   2. JS-мостом AndroidTV.isTv() из нативной оболочки;
     *   3. User-Agent (Android TV, Fire TV, WebOS, Tizen) — запасной вариант
     *      для TV-приставок и отладки в браузере.
     */
    function detectTv() {
        try {
            const flag = new URLSearchParams(window.location.search).get('tv');
            if (flag === '1') return true;
            if (flag === '0') return false;
        } catch (error) {
            /* URLSearchParams недоступен — пробуем дальше */
        }

        try {
            if (window.AndroidTV && typeof window.AndroidTV.isTv === 'function') {
                return !!window.AndroidTV.isTv();
            }
        } catch (error) {
            /* мост недоступен — пробуем дальше */
        }

        const ua = navigator.userAgent || '';
        return /Android TV|GoogleTV|Google TV|SMART-TV|SmartTV|AFT[A-Z]|BRAVIA|Web0S|WebOS|Tizen|HbbTV/i.test(ua);
    }

    if (!detectTv()) return;

    document.documentElement.classList.add('tv-mode');

    // TV-раскладка подключается только на телевизоре — на телефоне файл даже
    // не скачивается, поэтому мобильная версия остаётся ровно такой, как была.
    (function loadTvStylesheet() {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'tv.css';
        (document.head || document.documentElement).appendChild(link);
    }());

    // ======================================================================
    // Константы
    // ======================================================================

    const FOCUSABLE_SELECTOR = [
        'button:not([disabled])',
        'a[href]',
        'input:not([disabled]):not([type="hidden"])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        '.movie-card',
        '.fav-card:not(.skeleton)',
        '.mood-tag',
        '.country-item',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const FOCUS_CLASS = 'tv-focused';

    /**
     * Слои интерфейса от самого верхнего к нижнему. Активный слой определяет,
     * где искать фокус и что закрывать по кнопке «Назад».
     * closeWith — id штатной кнопки закрытия (нажимаем именно её, чтобы
     * отработала вся существующая логика: очистка трейлера, сброс статусов…).
     */
    const LAYERS = [
        { id: 'trailer', root: 'trailer-overlay', closeWith: 'trailer-close' },
        { id: 'bug', root: 'bug-modal-overlay', closeWith: 'btn-bug-close' },
        { id: 'confirm', root: 'confirm-modal-overlay', closeWith: 'btn-confirm-cancel' },
        { id: 'about', root: 'about-modal-overlay', closeWith: 'btn-about-close' },
        { id: 'country', root: 'country-picker-overlay', closeWith: 'country-picker-close' },
        { id: 'year', root: 'year-picker-overlay', closeWith: 'year-picker-close' },
        { id: 'popup', root: 'popup-overlay', closeWith: 'popup-close' },
        { id: 'settings', root: 'settings-overlay', closeWith: 'btn-settings-back' },
        { id: 'ai', root: 'ai-overlay', closeWith: 'btn-ai-back' },
        { id: 'search', root: 'search-overlay', closeWith: 'btn-search-back' },
        { id: 'user-menu', root: 'user-menu', closeWith: null }
    ];

    /**
     * Куда встаёт фокус при первом входе в слой — по убыванию приоритета.
     * На странице фильма первой идёт кнопка трейлера: открыл карточку →
     * сразу можно нажать OK и смотреть.
     */
    const LAYER_ENTRY_POINT = {
        trailer: ['trailer-close'],
        bug: ['btn-bug-send'],
        confirm: ['btn-confirm-cancel'],
        about: ['btn-about-close'],
        popup: ['popup-trailer', 'popup-watch', 'popup-toggle-watchlist', 'popup-close'],
        settings: ['btn-about-app'],
        ai: ['ai-input'],
        search: ['search-input'],
        'user-menu': ['btn-open-settings']
    };

    const DIRECTION_BY_KEY = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Up: 'up',
        Down: 'down',
        Left: 'left',
        Right: 'right'
    };

    const SELECT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Select', 'GoBack']);
    const BACK_KEYS = new Set(['Escape', 'Esc', 'Backspace', 'BrowserBack', 'XF86Back']);

    // ======================================================================
    // Вспомогательное
    // ======================================================================

    const $id = (id) => document.getElementById(id);

    /**
     * Контейнеры, которые прячутся не через display:none, а через
     * класс .active (opacity + pointer-events). Их содержимое остаётся в
     * DOM с ненулевыми размерами, поэтому закрытые окна нужно отсекать
     * явно — иначе фокус уезжает в невидимую модалку.
     */
    const OVERLAY_SELECTOR = [
        '.popup-overlay',
        '.search-overlay',
        '.ai-overlay',
        '.settings-overlay',
        '.settings-modal-overlay',
        '.country-picker-overlay',
        '.trailer-overlay',
        '.user-menu',
        '.app-announcement'
    ].join(',');

    function isInsideInactiveOverlay(el) {
        let node = el.closest(OVERLAY_SELECTOR);
        while (node) {
            if (!node.classList.contains('active')) return true;
            node = node.parentElement ? node.parentElement.closest(OVERLAY_SELECTOR) : null;
        }
        return false;
    }

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        if (el.disabled) return false;
        if (isInsideInactiveOverlay(el)) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;

        // Проверяем и сам элемент, и всех предков: скрытым может быть
        // любой из них, а вложенный элемент об этом «не знает».
        let node = el;
        while (node && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            if (style.visibility === 'hidden' || style.display === 'none') return false;

            // Открытый слой в первые доли секунды ещё анимируется
            // (opacity 0 → 1), но фокус в него ставить уже пора —
            // иначе после открытия карточки фильма пульт остался бы
            // управлять экраном под ней.
            const isAppearing = node.classList.contains('active');
            if (!isAppearing) {
                if (Number(style.opacity) === 0) return false;
                if (style.pointerEvents === 'none' && node !== el) return false;
            }

            node = node.parentElement;
        }

        return true;
    }

    function rectOf(el) {
        const r = el.getBoundingClientRect();
        return {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2
        };
    }

    /** Активный слой: самый верхний из открытых, иначе базовый экран. */
    function getActiveLayer() {
        for (const layer of LAYERS) {
            const root = $id(layer.root);
            if (root && root.classList.contains('active')) {
                return { id: layer.id, root, closeWith: layer.closeWith };
            }
        }

        const authScreen = $id('screen-auth');
        if (authScreen && authScreen.classList.contains('active')) {
            return { id: 'auth', root: authScreen, closeWith: null };
        }

        const mainApp = $id('main-app');
        if (mainApp && mainApp.style.display !== 'none') {
            return { id: 'main', root: mainApp, closeWith: null };
        }

        return { id: 'root', root: document.body, closeWith: null };
    }

    /**
     * Все элементы слоя, доступные для фокуса.
     * Из стека подбора берём только верхнюю карточку — нижние лежат под ней
     * и на телевизоре не должны перехватывать фокус.
     */
    function collectFocusables(layer) {
        const root = layer.root || document.body;
        const found = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SELECTOR));

        let topCardSeen = false;
        return found.filter((el) => {
            if (el.closest('[hidden]')) return false;

            if (el.classList.contains('movie-card')) {
                if (topCardSeen) return false;
                topCardSeen = true;
            }

            // На базовом экране скрытые вкладки не участвуют в навигации.
            const screen = el.closest('#main-app .screen');
            if (screen && !screen.classList.contains('active')) return false;

            // Формы входа/регистрации показываются по очереди.
            const form = el.closest('.auth-form');
            if (form && form.style.display === 'none') return false;

            return isVisible(el);
        });
    }

    // ======================================================================
    // Горизонтальные обложки
    //
    // На телевизоре вертикальный постер смотрится чужеродно: экран
    // широкий, и привычнее широкая обложка — как в телевизионных
    // кинотеатрах. У Кинопоиска такая обложка есть (coverUrl), но в ленте
    // она не приходит — только в карточке фильма.
    //
    // Лишних запросов почти не делаем: детали фильмов приложение и так
    // запрашивает (для избранного, поиска, страницы фильма) — мы просто
    // запоминаем обложки из этих ответов. Догружаем сами только для
    // карточек подбора, где деталей ещё нет.
    // ======================================================================

    const coverByMovieId = new Map();
    const coverByPosterUrl = new Map();
    const coverRequested = new Set();

    function rememberCoversFrom(data) {
        if (!data || typeof data !== 'object') return;

        if (Array.isArray(data)) {
            data.forEach(rememberCoversFrom);
            return;
        }
        if (Array.isArray(data.items)) data.items.forEach(rememberCoversFrom);

        const cover = data.coverUrl;
        if (!cover) return;

        const id = Number(data.kinopoiskId || data.filmId || data.id);
        if (Number.isFinite(id)) coverByMovieId.set(id, cover);

        [data.posterUrl, data.posterUrlPreview, data.poster, data.posterFull]
            .forEach((poster) => {
                if (poster) coverByPosterUrl.set(String(poster), cover);
            });
    }

    /** Подсматриваем обложки в ответах, которые приложение и так получает. */
    function watchApiResponses() {
        const originalFetch = window.fetch;
        if (typeof originalFetch !== 'function') return;

        window.fetch = function (...args) {
            const response = originalFetch.apply(this, args);
            try {
                const request = args[0];
                const url = typeof request === 'string' ? request : (request && request.url) || '';
                if (/\/api\/(movies|search)/.test(url)) {
                    response.then((result) => {
                        result.clone().json().then((data) => {
                            rememberCoversFrom(data);
                            applyWideCovers();
                        }).catch(() => { /* не JSON — не наш случай */ });
                    }).catch(() => { /* сетевая ошибка обработается приложением */ });
                }
            } catch (error) {
                /* перехват не должен мешать приложению */
            }
            return response;
        };
    }

    function requestCoverFor(movieId) {
        if (!Number.isFinite(movieId) || coverRequested.has(movieId)) return;
        coverRequested.add(movieId);

        const base = window.location.hostname === 'appassets.androidplatform.net'
            ? 'https://appassets.androidplatform.net/api-proxy'
            : 'http://185.73.126.11:8000';

        window.fetch(`${base}/api/movies/${movieId}`, { headers: { Accept: 'application/json' } })
            .catch(() => { /* нет обложки — останется постер */ });
    }

    /** Подставляет широкую обложку в карточки, где она уже известна. */
    function applyWideCovers() {
        document.querySelectorAll('#card-stack .movie-card').forEach((card) => {
            const movieId = Number(card.dataset.id);
            const cover = coverByMovieId.get(movieId);
            const background = card.querySelector('.card-bg');
            if (!background) return;

            if (!cover) {
                requestCoverFor(movieId);
                return;
            }
            if (card.dataset.tvCover === cover) return;

            card.dataset.tvCover = cover;
            background.style.backgroundImage = `url('${cover}')`;
        });

        document.querySelectorAll('.fav-card img').forEach((poster) => {
            const cover = coverByPosterUrl.get(poster.getAttribute('src') || '');
            if (cover && poster.src !== cover) poster.src = cover;
        });
    }

    // ======================================================================
    // Фокус
    // ======================================================================

    let lastFocusedByLayer = Object.create(null);

    // Пока пользователь не тронул пульт на текущем экране, модуль вправе
    // уточнять фокус (например, перевести его на подгрузившуюся кнопку
    // трейлера). После первого же нажатия — только ручное управление.
    let userTookOverLayer = false;

    function markFocused(el) {
        const previous = document.querySelector('.' + FOCUS_CLASS);
        if (previous && previous !== el) previous.classList.remove(FOCUS_CLASS);
        if (el) el.classList.add(FOCUS_CLASS);
    }

    function focusElement(el, layerId) {
        if (!el) return false;

        if (!el.hasAttribute('tabindex') && !isNativelyFocusable(el)) {
            el.setAttribute('tabindex', '0');
        }

        try {
            el.focus({ preventScroll: true });
        } catch (error) {
            el.focus();
        }

        markFocused(el);
        scrollIntoViewSoftly(el);

        const id = layerId || getActiveLayer().id;
        lastFocusedByLayer[id] = el;
        return true;
    }

    function isNativelyFocusable(el) {
        const tag = el.tagName;
        return tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' ||
            tag === 'SELECT' || (tag === 'A' && el.hasAttribute('href'));
    }

    function scrollIntoViewSoftly(el) {
        try {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        } catch (error) {
            el.scrollIntoView(false);
        }
    }

    function getCurrentFocus(layer) {
        const active = document.activeElement;
        if (active && active !== document.body && isVisible(active) &&
            (!layer.root || layer.root.contains(active))) {
            return active;
        }
        return null;
    }

    function isTextInput(el) {
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    }

    /**
     * Точка входа в слой: сохранённый фокус → штатная точка входа → первый элемент.
     *
     * avoidTextInputs — режим автоматического восстановления фокуса. На
     * телевизоре фокус на поле ввода заставляет систему показать экранную
     * клавиатуру. Если после её закрытия кнопкой «Назад» вернуть фокус
     * обратно в поле, клавиатура откроется снова, и уйти с поля станет
     * невозможно. Поэтому сами, без действия пользователя, в текстовые
     * поля не встаём.
     */
    function focusLayerEntry(layer, ignoreRemembered, avoidTextInputs) {
        const acceptable = (el) => el && isVisible(el) &&
            !(avoidTextInputs && isTextInput(el));
        // Пока пользователь сам не двигал фокус, на главном экране он
        // должен стоять на карточке фильма — это и есть главное действие.
        // Карточка появляется позже шапки (лента ещё грузится), поэтому
        // проверяем её раньше, чем запомненный ранее элемент.
        if (layer.id === 'main' && !userTookOverLayer) {
            const firstCard = document.querySelector('#card-stack .movie-card');
            if (firstCard && isVisible(firstCard)) return focusElement(firstCard, layer.id);
        }

        const remembered = lastFocusedByLayer[layer.id];
        if (!ignoreRemembered && acceptable(remembered) &&
            layer.root.contains(remembered)) {
            return focusElement(remembered, layer.id);
        }

        const entryIds = LAYER_ENTRY_POINT[layer.id] || [];
        for (const entryId of entryIds) {
            const entry = $id(entryId);
            if (acceptable(entry)) return focusElement(entry, layer.id);
        }

        if (layer.id === 'main') {
            const topCard = document.querySelector('#card-stack .movie-card');
            if (topCard && isVisible(topCard)) return focusElement(topCard, layer.id);

            // Карточек нет — значит открыт экран «Фильмы закончились» или
            // «Ошибка загрузки». Ставим фокус на главное действие, чтобы
            // пользователь мог продолжить, не разыскивая кнопку пультом.
            for (const id of ['btn-reset', 'btn-retry']) {
                const button = $id(id);
                if (button && isVisible(button)) return focusElement(button, layer.id);
            }
        }

        const candidates = collectFocusables(layer);
        const preferred = avoidTextInputs
            ? candidates.filter((el) => !isTextInput(el))
            : candidates;
        const fallback = preferred.length ? preferred : candidates;
        if (fallback.length) return focusElement(fallback[0], layer.id);
        return false;
    }

    // ======================================================================
    // Геометрический поиск соседа в направлении
    // ======================================================================

    function findInDirection(current, candidates, direction) {
        const cur = rectOf(current);
        let best = null;
        let bestScore = Infinity;

        for (const el of candidates) {
            if (el === current) continue;
            const r = rectOf(el);

            let mainGap;      // расстояние по направлению движения
            let crossOverlap; // перекрытие по поперечной оси
            let crossGap;     // смещение центров по поперечной оси

            if (direction === 'right') {
                if (r.cx <= cur.cx + 1) continue;
                mainGap = Math.max(0, r.left - cur.right);
                crossOverlap = Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top);
                crossGap = Math.abs(r.cy - cur.cy);
            } else if (direction === 'left') {
                if (r.cx >= cur.cx - 1) continue;
                mainGap = Math.max(0, cur.left - r.right);
                crossOverlap = Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top);
                crossGap = Math.abs(r.cy - cur.cy);
            } else if (direction === 'down') {
                if (r.cy <= cur.cy + 1) continue;
                mainGap = Math.max(0, r.top - cur.bottom);
                crossOverlap = Math.min(cur.right, r.right) - Math.max(cur.left, r.left);
                crossGap = Math.abs(r.cx - cur.cx);
            } else {
                if (r.cy >= cur.cy - 1) continue;
                mainGap = Math.max(0, cur.top - r.bottom);
                crossOverlap = Math.min(cur.right, r.right) - Math.max(cur.left, r.left);
                crossGap = Math.abs(r.cx - cur.cx);
            }

            // Элементы, стоящие «в одну линию» с текущим, всегда предпочтительнее:
            // так фокус не перескакивает по диагонали через весь экран.
            const alignmentPenalty = crossOverlap > 0 ? crossGap * 0.2 : 900 + crossGap * 2;
            const score = mainGap + alignmentPenalty;

            if (score < bestScore) {
                bestScore = score;
                best = el;
            }
        }

        return best;
    }

    // ======================================================================
    // Экран «Подбор»: свайпы заменены стрелками пульта
    // ======================================================================

    /**
     * На карточке подбора горизонтальные стрелки повторяют мобильные свайпы:
     *   ← — пропустить, → — нравится.
     * Вертикальные оставлены под навигацию: ↑ уводит к фильтрам настроения,
     * ↓ — к ряду кнопок, где лежат «Хочу посмотреть» и «Уже посмотрел».
     * Логика подбора при этом не меняется — жмутся те же самые кнопки.
     */
    function handleDiscoverCardDirection(current, direction) {
        if (!current || !current.classList.contains('movie-card')) return false;

        const actionByDirection = { left: 'btn-dislike', right: 'btn-like' };
        const buttonId = actionByDirection[direction];
        if (!buttonId) return false;

        const button = $id(buttonId);
        if (!button || !isVisible(button)) return false;

        button.click();
        return true;
    }

    // ======================================================================
    // Навигация по сеткам («Избранное», результаты поиска)
    //
    // Геометрический поиск здесь не годится: он выбирает ближайший к
    // центру элемент, поэтому с вкладки фокус попадал в середину ряда, а
    // при движении вверх перескакивал между шапкой и карточками. В сетке
    // фокус должен ходить строго по рядам и колонкам.
    // ======================================================================

    function getGridColumns(grid) {
        const template = window.getComputedStyle(grid).gridTemplateColumns;
        const columns = template.split(' ').filter(Boolean).length;
        return Math.max(1, columns);
    }

    function getGridItems(grid) {
        return Array.prototype.slice
            .call(grid.querySelectorAll('.fav-card, .reset-btn'))
            .filter(isVisible);
    }

    /** Видимые сетки текущего экрана в порядке следования сверху вниз. */
    function getVisibleGrids(fromGrid) {
        const screen = fromGrid.closest('#screen-favorites, .search-body') || document;
        return Array.prototype.slice
            .call(screen.querySelectorAll('.favorites-grid'))
            .filter((grid) => getGridItems(grid).length > 0);
    }

    function gridNeighbour(current, direction) {
        const grid = current.closest('.favorites-grid');
        if (!grid) return null;

        const items = getGridItems(grid);
        const index = items.indexOf(current);
        if (index < 0) return null;

        const columns = getGridColumns(grid);
        const column = index % columns;

        if (direction === 'left') return items[index - 1] || null;
        if (direction === 'right') return items[index + 1] || null;

        if (direction === 'down') {
            const below = items[index + columns];
            if (below) return below;

            // Ниже в этой секции пусто — переходим к следующей.
            const grids = getVisibleGrids(grid);
            const nextGrid = grids[grids.indexOf(grid) + 1];
            if (!nextGrid) return null;
            const nextItems = getGridItems(nextGrid);
            return nextItems[Math.min(column, nextItems.length - 1)] || nextItems[0] || null;
        }

        if (direction === 'up') {
            const above = items[index - columns];
            if (above) return above;

            // Мы в верхнем ряду секции: идём в предыдущую, а если её нет —
            // поднимаемся к вкладкам, а не в случайную кнопку шапки.
            const grids = getVisibleGrids(grid);
            const previousGrid = grids[grids.indexOf(grid) - 1];
            if (previousGrid) {
                const previousItems = getGridItems(previousGrid);
                const previousColumns = getGridColumns(previousGrid);
                const lastRowStart = Math.floor((previousItems.length - 1) / previousColumns) * previousColumns;
                return previousItems[Math.min(lastRowStart + column, previousItems.length - 1)] || null;
            }

            const activeTab = document.querySelector('.tab-btn.active') || document.querySelector('.tab-btn');
            return activeTab && isVisible(activeTab) ? activeTab : null;
        }

        return null;
    }

    /** Первая карточка первой непустой сетки — точка входа в списки. */
    function firstCardOfLists() {
        const screen = $id('screen-favorites');
        if (!screen || !screen.classList.contains('active')) return null;
        const grids = Array.prototype.slice.call(screen.querySelectorAll('.favorites-grid'));
        for (const grid of grids) {
            const items = getGridItems(grid);
            if (items.length) return items[0];
        }
        return null;
    }

    /**
     * Экран «Подбор» состоит из горизонтальных рядов: шапка → вкладки →
     * фильтры → карточка → кнопки действий. Вертикальные переходы между
     * ними задаём явно, чтобы фокус двигался рядами, а не по диагонали
     * к случайно оказавшемуся рядом элементу.
     */
    function preferredNeighbour(current, direction) {
        // В сетках — своя, построчная навигация.
        const inGrid = gridNeighbour(current, direction);
        if (inGrid) return inGrid;
        const pick = (selector) => {
            const el = document.querySelector(selector);
            return el && isVisible(el) ? el : null;
        };

        if (current.classList.contains('movie-card')) {
            if (direction === 'up') return pick('.mood-tag.active') || pick('.mood-tag');
            if (direction === 'down') return pick('#swipe-actions .action-btn');
        }

        if (current.classList.contains('action-btn') && direction === 'up') {
            return pick('#card-stack .movie-card');
        }

        if (current.classList.contains('mood-tag')) {
            if (direction === 'up') return pick('.tab-btn.active') || pick('.tab-btn');
            if (direction === 'down') return pick('#card-stack .movie-card');
        }

        // Из шапки спускаемся на вкладки — следующий ряд по порядку,
        // а не в середину списка, куда ведёт геометрия.
        if (current.closest('.app-header') && direction === 'down') {
            const tab = pick('.tab-btn.active') || pick('.tab-btn');
            if (tab) return tab;
        }

        if (current.classList.contains('tab-btn') && direction === 'down') {
            // В «Избранном» — всегда первая карточка списка, а не та, что
            // случайно оказалась под вкладкой.
            const firstCard = firstCardOfLists();
            if (firstCard) return firstCard;
            return pick('.mood-tag.active') || pick('.mood-tag') || pick('#card-stack .movie-card');
        }

        return null;
    }

    // ======================================================================
    // Обработка нажатий
    // ======================================================================

    /**
     * Сообщаем оболочке, открыт ли трейлер: пока он на экране, плеер
     * перехватывает фокус, и нажатия OK обрабатывает уже оболочка.
     */
    function notifyShellAboutTrailer(isOpen) {
        // Класс включает «режим экономии»: под плеером ничего не рисуем
        // и не анимируем, чтобы телевизору хватило сил на видео.
        document.documentElement.classList.toggle('tv-trailer-open', !!isOpen);

        try {
            if (window.AndroidTV && typeof window.AndroidTV.setTrailerOpen === 'function') {
                window.AndroidTV.setTrailerOpen(!!isOpen);
            }
        } catch (error) {
            /* оболочка старой версии — не страшно */
        }
    }

    /** Нажатие по центру экрана силами нативной оболочки. */
    function tapPlayerCenter() {
        try {
            if (window.AndroidTV && typeof window.AndroidTV.tapCenter === 'function') {
                window.AndroidTV.tapCenter();
                return true;
            }
        } catch (error) {
            /* оболочка старой версии — управляем плеером как получится */
        }
        return false;
    }

    function activate(el) {
        if (!el) return;

        // Текстовые поля: по OK показываем экранную клавиатуру телевизора.
        // Одного focus() мало, если поле уже в фокусе, — клавиатуру
        // открывает именно касание, поэтому дополняем кликом.
        if (isTextInput(el)) {
            el.focus();
            el.click();
            return;
        }

        el.click();
    }

    function onKeyDown(event) {
        if (event.defaultPrevented) return;

        const key = event.key;
        const layer = getActiveLayer();

        // Нажатие может прийти раньше, чем наблюдатель за DOM заметит
        // смену экрана. Фиксируем слой здесь же, иначе наблюдатель позже
        // решит, что пользователь ещё ничего не нажимал, и заберёт фокус.
        if (layer.id !== ensureFocusAlive.lastLayerId) {
            ensureFocusAlive.lastLayerId = layer.id;
        }
        userTookOverLayer = true;

        if (BACK_KEYS.has(key)) {
            // Backspace внутри текстового поля — это редактирование текста.
            const active = document.activeElement;
            const isTextField = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
            if (key === 'Backspace' && isTextField) return;

            if (handleBack()) event.preventDefault();
            return;
        }

        if (SELECT_KEYS.has(key) || event.keyCode === 13 || event.keyCode === 23) {
            // Внутри трейлера OK управляет самим плеером: его кнопки
            // понимают только касание, поэтому просим оболочку нажать
            // по центру экрана. Так трейлер стартует со звуком.
            if (layer.id === 'trailer' && tapPlayerCenter()) {
                event.preventDefault();
                return;
            }

            const current = getCurrentFocus(layer);
            if (!current) {
                focusLayerEntry(layer);
                event.preventDefault();
                return;
            }
            // Enter в текстовом поле уже обрабатывается приложением
            // (поиск по названию, отправка сообщения ИИ) — не мешаем.
            if (current.tagName === 'INPUT' || current.tagName === 'TEXTAREA') return;

            activate(current);
            event.preventDefault();
            return;
        }

        const direction = DIRECTION_BY_KEY[key];
        if (!direction) return;

        const current = getCurrentFocus(layer);
        if (!current) {
            focusLayerEntry(layer);
            event.preventDefault();
            return;
        }

        if (handleDiscoverCardDirection(current, direction)) {
            event.preventDefault();
            return;
        }

        const candidates = collectFocusables(layer);
        const next = preferredNeighbour(current, direction) ||
            findInDirection(current, candidates, direction);

        if (next) {
            focusElement(next, layer.id);
            event.preventDefault();
            return;
        }

        // Дальше в этом направлении ничего нет: подтягиваем длинный список
        // (избранное, диалог ИИ), чтобы пользователь видел, что край достигнут.
        const scroller = current.closest('#screen-favorites, .search-body, .ai-messages, .settings-sheet, .popup, .country-picker-list');
        if (scroller && (direction === 'up' || direction === 'down')) {
            scroller.scrollBy({ top: direction === 'down' ? 200 : -200, behavior: 'smooth' });
            event.preventDefault();
        }
    }

    /**
     * Кнопка «Назад» на пульте.
     * @returns {boolean} true — если приложение обработало нажатие само
     *                    (закрыло слой или вернулось на «Подбор»).
     */
    function handleBack() {
        for (const layer of LAYERS) {
            const root = $id(layer.root);
            if (!root || !root.classList.contains('active')) continue;

            if (layer.closeWith) {
                const closeButton = $id(layer.closeWith);
                if (closeButton) {
                    closeButton.click();
                    restoreFocusAfterLayerClose();
                    return true;
                }
            }

            // Меню профиля закрывается кликом мимо себя — повторяем это.
            root.classList.remove('active');
            restoreFocusAfterLayerClose();
            return true;
        }

        // На вкладке «Избранное» кнопка «Назад» возвращает к «Подбору»,
        // и только со стартовой вкладки выходит из приложения.
        const favoritesTab = $id('tab-favorites');
        const discoverTab = $id('tab-discover');
        if (favoritesTab && favoritesTab.classList.contains('active') && discoverTab) {
            discoverTab.click();
            window.requestAnimationFrame(() => focusLayerEntry(getActiveLayer()));
            return true;
        }

        return false;
    }

    /**
     * Содержимое слоя появляется не сразу: карточка фильма догружает
     * детали и кнопку трейлера, избранное — постеры. Поэтому фокус
     * ставим сразу на то, что уже есть, и продолжаем следить, не появится
     * ли элемент поважнее (для страницы фильма — кнопка трейлера).
     *
     * Как только пользователь сам нажал кнопку на пульте, вмешательство
     * прекращается: перехватывать фокус из-под руки нельзя.
     */
    function focusLayerEntryWithRetry(attempt) {
        if (attempt > 0 && userTookOverLayer) return;

        const layer = getActiveLayer();
        // На повторных попытках не цепляемся за уже поставленный нами
        // фокус — иначе кнопка трейлера, появившаяся позже, так и не
        // получит его.
        focusLayerEntry(layer, attempt > 0);

        if (attempt >= 8) return;

        const preferredId = (LAYER_ENTRY_POINT[layer.id] || [])[0];
        if (!preferredId) return;

        const preferred = $id(preferredId);
        const alreadyOnPreferred = preferred && document.activeElement === preferred;
        if (alreadyOnPreferred) return;

        window.setTimeout(() => focusLayerEntryWithRetry(attempt + 1), 150);
    }

    /**
     * Слои закрываются с анимацией (0.3–0.4 с). Пока она идёт, элементы
     * ещё видимы, поэтому одной проверки сразу после закрытия мало —
     * фокус остался бы на кнопке уже исчезнувшего окна. Проверяем
     * несколько раз: до, во время и после завершения анимации.
     */
    /**
     * Кнопка «Трейлер» появляется на странице фильма не сразу: сначала
     * запрос к API, потом ещё треть секунды анимация появления. Это
     * главное действие экрана, поэтому дожидаемся её и переводим фокус.
     *
     * Ожидание прекращается, как только пользователь сам нажал что-то на
     * пульте или ушёл со страницы фильма — фокус из-под руки не забираем.
     */
    function watchForTrailerButton() {
        const startedAt = Date.now();

        const tick = () => {
            if (getActiveLayer().id !== 'popup') return;
            if (userTookOverLayer) return;
            if (Date.now() - startedAt > 6000) return;

            const trailerButton = $id('popup-trailer');
            if (trailerButton && isVisible(trailerButton)) {
                if (document.activeElement !== trailerButton) {
                    focusElement(trailerButton, 'popup');
                }
                return;
            }

            window.setTimeout(tick, 200);
        };

        window.setTimeout(tick, 200);
    }

    /**
     * Трейлер на телевизоре — со звуком.
     *
     * Плеер трейлеров живёт на чужом домене, и вмешаться в него снаружи
     * нельзя. При автозапуске он включает себя приглушённым: беззвучный
     * старт — единственный, который движок разрешает без действия
     * пользователя. Зато запуск по нажатию идёт с нормальным звуком.
     *
     * Поэтому на телевизоре автозапуск выключаем и сразу отдаём фокус
     * плееру: пользователь нажимает OK один раз и смотрит со звуком.
     * Кнопка «Назад» продолжает работать — её обрабатывает оболочка.
     *
     * Правка живёт здесь, а не в общем коде: на телефоне поведение
     * трейлера остаётся прежним.
     */
    function prepareTrailerPlayer() {
        const frame = $id('trailer-frame');
        if (!frame) return;

        const applyToIframe = () => {
            const iframe = frame.querySelector('iframe');
            if (!iframe || iframe.dataset.tvReady === '1') return;
            if (!iframe.src || iframe.src === 'about:blank') return;

            iframe.dataset.tvReady = '1';

            try {
                const url = new URL(iframe.src);
                // autoplay приходит и из адреса трейлера с сервера,
                // и из общего кода — снимаем его в обоих случаях.
                url.searchParams.delete('autoplay');
                url.searchParams.set('autoplay', '0');
                iframe.src = url.toString();
            } catch (error) {
                /* нестандартный адрес — оставляем как есть */
            }

            // Фокус остаётся в нашем документе: иначе нажатия уходят
            // внутрь плеера (он на чужом домене) и обработчик пульта их
            // больше не видит. Нажатие OK мы транслируем плееру сами —
            // касанием через оболочку.
            iframe.setAttribute('tabindex', '-1');
        };

        new MutationObserver(applyToIframe).observe(frame, { childList: true });
        applyToIframe();
    }

    function restoreFocusAfterLayerClose() {
        // Слой сменился — пусть следующая проверка это заметит.
        ensureFocusAlive.lastLayerId = null;

        [0, 80, 260, 480].forEach((delay) => {
            window.setTimeout(() => {
                const layer = getActiveLayer();
                const active = document.activeElement;
                const focusStillValid = active && active !== document.body &&
                    isVisible(active) && layer.root.contains(active);
                if (!focusStillValid) focusLayerEntry(layer, true, true);
            }, delay);
        });
    }

    // ======================================================================
    // Слежение за интерфейсом
    // ======================================================================

    /**
     * Приложение постоянно перерисовывает DOM (новая карточка после свайпа,
     * догрузка избранного, результаты поиска). Следим, чтобы фокус не пропал:
     * если элемент под фокусом исчез — переводим фокус на разумную замену.
     */
    function watchDomChanges() {
        let scheduled = false;

        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            window.requestAnimationFrame(() => {
                scheduled = false;
                ensureFocusAlive();
                applyWideCovers();
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
    }

    function ensureFocusAlive() {
        const layer = getActiveLayer();

        // Слой сменился (открылся попап, закрылся поиск) — переводим фокус в него.
        if (layer.id !== ensureFocusAlive.lastLayerId) {
            ensureFocusAlive.lastLayerId = layer.id;
            userTookOverLayer = false;
            notifyShellAboutTrailer(layer.id === 'trailer');
            focusLayerEntryWithRetry(0);
            if (layer.id === 'popup') watchForTrailerButton();
            return;
        }

        const active = document.activeElement;
        const focusLost = !active || active === document.body || !active.isConnected || !isVisible(active);
        if (!focusLost && layer.root.contains(active)) {
            markFocused(active);
            return;
        }

        // Восстановление после потери фокуса — автоматическое, поэтому
        // в текстовые поля не встаём (иначе на телевизоре снова всплывёт
        // экранная клавиатура, которую пользователь только что закрыл).
        focusLayerEntry(layer, false, true);
    }

    ensureFocusAlive.lastLayerId = null;

    // ======================================================================
    // Запуск
    // ======================================================================

    function start() {
        document.addEventListener('keydown', onKeyDown, true);

        // Фокус может увести само приложение (например, поле поиска
        // фокусируется при открытии) — подсвечиваем актуальный элемент.
        document.addEventListener('focusin', (event) => {
            if (event.target && event.target !== document.body) {
                markFocused(event.target);
                lastFocusedByLayer[getActiveLayer().id] = event.target;
            }
        });

        watchDomChanges();
        prepareTrailerPlayer();

        // Страховка: не всякое исчезновение элемента сопровождается
        // мутацией DOM (окно может скрыться по завершении анимации).
        // Пульт не должен «повиснуть» ни при каком стечении обстоятельств.
        window.setInterval(() => {
            // Во время трейлера проверку не делаем: она вычисляет стили
            // по всей цепочке родителей, а телевизору эти такты нужнее
            // для плавного видео. Управление здесь всё равно у плеера.
            if (document.documentElement.classList.contains('tv-trailer-open')) return;

            const active = document.activeElement;
            if (!active || active === document.body || !isVisible(active)) {
                ensureFocusAlive();
            }
        }, 700);

        // Первый фокус ставим, когда приложение отрисовало стартовый экран.
        window.setTimeout(() => focusLayerEntry(getActiveLayer()), 300);
    }

    // Обложки перехватываем сразу: приложение начинает запрашивать данные
    // раньше, чем построит страницу, и первые ответы упускать нельзя.
    watchApiResponses();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Нативная оболочка обращается сюда из onBackPressed.
    window.FeelFilmTV = {
        isTv: true,
        handleBack,
        refocus: () => focusLayerEntry(getActiveLayer())
    };
}());
