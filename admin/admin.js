/* FeelFilm Admin — модуль клиентской логики.
 * Использует Firebase Auth + Firestore (тот же проект, что у приложения).
 * Все данные читаются напрямую из Firestore; для системного статуса ходит в бэкенд.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore,
    collection,
    getDocs,
    getCountFromServer,
    query,
    where,
    updateDoc,
    doc,
    orderBy,
    limit as fbLimit,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// ---- Config ----
const firebaseConfig = {
    apiKey: "AIzaSyDHa1gPxZyYPNEcE69BZF9fqogOtMvofhk",
    authDomain: "feelfilm-13a52.firebaseapp.com",
    projectId: "feelfilm-13a52",
    storageBucket: "feelfilm-13a52.firebasestorage.app",
    messagingSenderId: "524135203863",
    appId: "1:524135203863:web:10214378248da788ac4852"
};
const ADMIN_EMAILS = new Set(['nazimaov2@gmail.com']);
const BACKEND_ORIGIN = window.location.origin.replace(/\/$/, ''); // тот же хост, откуда открыта админка

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- DOM helpers ----
const $ = (id) => document.getElementById(id);
const screenLogin = $('screen-login');
const screenAdmin = $('screen-admin');

function show(section) {
    screenLogin.classList.toggle('is-hidden', section !== 'login');
    screenAdmin.classList.toggle('is-hidden', section !== 'admin');
    // На всякий случай убираем hidden-атрибут, если он остался от старой версии HTML.
    screenLogin.removeAttribute('hidden');
    screenAdmin.removeAttribute('hidden');
}

// ---- Auth flow ----
$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const errorEl = $('login-error');
    errorEl.textContent = '';
    const btn = $('btn-login');
    btn.disabled = true;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        errorEl.textContent = mapAuthError(err);
    } finally {
        btn.disabled = false;
    }
});

$('btn-logout').addEventListener('click', () => signOut(auth));

$('btn-reset').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const errorEl = $('login-error');
    if (!email) {
        errorEl.textContent = 'Введите email выше и повторите.';
        return;
    }
    errorEl.textContent = '';
    try {
        await sendPasswordResetEmail(auth, email);
        errorEl.style.color = '#4ade80';
        errorEl.textContent = `Письмо для сброса пароля отправлено на ${email}. Проверьте почту (в т.ч. «Спам»).`;
    } catch (err) {
        errorEl.style.color = '';
        errorEl.textContent = mapAuthError(err);
    }
});

onAuthStateChanged(auth, (user) => {
    document.body.classList.remove('booting');
    if (!user) {
        show('login');
        return;
    }
    const email = (user.email || '').toLowerCase();
    if (!ADMIN_EMAILS.has(email)) {
        $('login-error').textContent = 'Этот аккаунт не является администратором. Обратитесь к владельцу проекта.';
        signOut(auth);
        return;
    }
    $('admin-email').textContent = user.email;
    show('admin');
    bootDashboard();
});

function mapAuthError(err) {
    const code = err?.code || '';
    if (code.includes('invalid') || code.includes('wrong-password') || code.includes('user-not-found')) {
        return 'Неверный email или пароль. Если забыли — нажмите «Забыли пароль?».';
    }
    if (code.includes('too-many-requests')) return 'Слишком много попыток. Подождите пару минут.';
    if (code.includes('network')) return 'Проблема со связью. Проверьте интернет.';
    return err?.message || 'Не удалось войти.';
}

// ---- Tabs ----
document.querySelectorAll('.side-nav button').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
    document.querySelectorAll('.side-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    const loaders = {
        overview: loadOverview,
        catalog: initCatalogTab,
        bugs: loadBugs,
        stats: loadStats,
        trends: loadTrends,
        system: loadSystem
    };
    if (loaders[name]) loaders[name]();
}

// ---- Admin API helper (adds Firebase ID Token to Authorization header) ----
async function adminFetch(path, options = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Не авторизован');
    const token = await user.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const resp = await fetch(BACKEND_ORIGIN + path, { ...options, headers });
    if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); if (j.detail) msg += ': ' + j.detail; } catch {}
        throw new Error(msg);
    }
    return resp.json();
}

// ============================================================
// CATALOG (edit movies + trailers)
// ============================================================

const EDITABLE_FIELDS = [
    { key: 'nameRu', label: 'Название (рус.)', type: 'text' },
    { key: 'nameEn', label: 'Название (англ.)', type: 'text' },
    { key: 'nameOriginal', label: 'Оригинальное название', type: 'text' },
    { key: 'year', label: 'Год', type: 'text' },
    { key: 'description', label: 'Описание', type: 'textarea' },
    { key: 'shortDescription', label: 'Краткое описание', type: 'textarea' },
    { key: 'genres', label: 'Жанры (через запятую)', type: 'text', hint: 'Например: боевик, драма, триллер' },
    { key: 'posterUrl', label: 'Постер (URL)', type: 'text' },
    { key: 'posterUrlPreview', label: 'Постер (превью URL)', type: 'text' },
    { key: 'trailerUrl', label: 'URL трейлера', type: 'text', hint: 'Вставь любую ссылку RuTube (обычную rutube.ru/video/... или embed rutube.ru/play/embed/...) — она сама превратится в embed. Также поддерживается виджет Кинопоиска (widgets.kinopoisk.ru/...). Пустое поле = вернуть авто-трейлер.' },
    { key: 'trailerName', label: 'Название трейлера', type: 'text' }
];

let catalogState = { results: [], selectedId: null, currentData: null, editorTab: 'edit' };
let catalogInitialized = false;

function initCatalogTab() {
    if (catalogInitialized) return;
    catalogInitialized = true;
    $('btn-catalog-search').addEventListener('click', runCatalogSearch);
    $('catalog-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runCatalogSearch(); }
    });
}

async function runCatalogSearch() {
    const q = $('catalog-search').value.trim();
    if (!q) return;
    const list = $('catalog-results');
    list.innerHTML = '<div class="muted">Загрузка…</div>';

    // Если это цифры — трактуем как ID, сразу пробуем открыть.
    if (/^\d+$/.test(q)) {
        const id = Number(q);
        list.innerHTML = `<div class="catalog-result active" data-id="${id}">
            <div class="catalog-result-body">
                <div class="catalog-result-title">Открыть по ID: #${id}</div>
                <div class="catalog-result-meta">Прямой доступ</div>
            </div>
        </div>`;
        list.querySelector('.catalog-result').addEventListener('click', () => openMovieEditor(id));
        openMovieEditor(id);
        return;
    }

    try {
        const url = `${BACKEND_ORIGIN}/api/search?query=${encodeURIComponent(q)}&limit=30`;
        const r = await fetch(url);
        const d = await r.json();
        const items = d.items || [];
        catalogState.results = items;
        if (!items.length) {
            list.innerHTML = '<div class="muted">Ничего не найдено.</div>';
            return;
        }
        list.innerHTML = items.map(renderCatalogResultItem).join('');
        list.querySelectorAll('.catalog-result').forEach((el) => {
            el.addEventListener('click', () => {
                list.querySelectorAll('.catalog-result').forEach((x) => x.classList.remove('active'));
                el.classList.add('active');
                openMovieEditor(Number(el.dataset.id));
            });
        });
    } catch (err) {
        list.innerHTML = `<div class="error-hint">Ошибка поиска: ${escapeHtml(err.message)}</div>`;
    }
}

function renderCatalogResultItem(m) {
    const id = m.kinopoiskId || m.filmId || m.id;
    const title = escapeHtml(m.nameRu || m.nameEn || m.nameOriginal || `#${id}`);
    const year = m.year ? ` · ${escapeHtml(String(m.year))}` : '';
    const poster = escapeHtml(m.posterUrlPreview || m.posterUrl || '');
    return `<div class="catalog-result" data-id="${id}">
        <img src="${poster}" alt="" onerror="this.style.visibility='hidden'">
        <div class="catalog-result-body">
            <div class="catalog-result-title">${title}</div>
            <div class="catalog-result-meta">#${id}${year}</div>
        </div>
    </div>`;
}

async function openMovieEditor(id) {
    catalogState.selectedId = id;
    catalogState.editorTab = 'edit';
    const editor = $('catalog-editor');
    editor.innerHTML = '<div class="muted">Загрузка карточки…</div>';
    try {
        const data = await adminFetch(`/api/admin/movie/${id}`);
        catalogState.currentData = data;
        renderEditor(data);
    } catch (err) {
        editor.innerHTML = `<div class="error-hint">Не удалось загрузить: ${escapeHtml(err.message)}</div>`;
    }
}

function renderEditor(data) {
    const editor = $('catalog-editor');
    const original = data.original || {};
    const override = data.override || {};
    const id = data.movieId;
    const title = escapeHtml(override.nameRu || original.nameRu || original.nameEn || original.nameOriginal || `#${id}`);
    const posterUrl = escapeHtml(override.posterUrlPreview || override.posterUrl || original.posterUrlPreview || original.posterUrl || '');
    const meta = escapeHtml([`#${id}`, original.year || '', (Array.isArray(original.countries) && original.countries[0]?.country) || ''].filter(Boolean).join(' · '));

    editor.innerHTML = `
        <div class="editor-header">
            <img class="editor-poster" src="${posterUrl}" alt="" onerror="this.style.visibility='hidden'">
            <div style="min-width:0;flex:1">
                <div class="editor-title">${title}</div>
                <div class="editor-meta">${meta}</div>
            </div>
        </div>
        <div class="editor-tabs">
            <button class="editor-tab ${catalogState.editorTab === 'edit' ? 'active' : ''}" data-etab="edit">Редактирование</button>
            <button class="editor-tab ${catalogState.editorTab === 'history' ? 'active' : ''}" data-etab="history">История</button>
        </div>
        <div id="editor-body"></div>
    `;
    editor.querySelectorAll('.editor-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            catalogState.editorTab = tab.dataset.etab;
            editor.querySelectorAll('.editor-tab').forEach((t) => t.classList.toggle('active', t.dataset.etab === catalogState.editorTab));
            if (catalogState.editorTab === 'edit') renderEditorForm(data);
            else renderEditorHistory(id);
        });
    });
    renderEditorForm(data);
}

function renderEditorForm(data) {
    const body = $('editor-body');
    const original = data.original || {};
    const override = data.override || {};
    const fields = EDITABLE_FIELDS.map((f) => {
        // Текущее значение: override, если есть, иначе original.
        // Для genres приводим array-of-{genre:...} к CSV, чтобы редактировать одной строкой.
        let overrideValue = override[f.key];
        let originalValue = f.key === 'trailerUrl' || f.key === 'trailerName' ? '' : original[f.key];
        if (f.key === 'genres') {
            overrideValue = Array.isArray(overrideValue) ? overrideValue.map((g) => g.genre || g).join(', ') : (overrideValue || '');
            originalValue = Array.isArray(originalValue) ? originalValue.map((g) => g.genre || g).join(', ') : (originalValue || '');
        }
        if (f.key === 'trailerUrl') {
            originalValue = ''; // trailerUrl не в фильме, а отдельно — оригинала как поля нет.
        }
        const currentValue = overrideValue != null && overrideValue !== '' ? overrideValue : originalValue || '';
        const isOverridden = overrideValue != null && overrideValue !== '';
        const input = f.type === 'textarea'
            ? `<textarea data-field="${f.key}" placeholder="${escapeHtml(String(originalValue || ''))}">${escapeHtml(String(currentValue))}</textarea>`
            : `<input type="text" data-field="${f.key}" placeholder="${escapeHtml(String(originalValue || ''))}" value="${escapeHtml(String(currentValue))}">`;
        const hint = f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '';
        const orig = originalValue && isOverridden
            ? `<div class="original">Ориг.: ${escapeHtml(String(originalValue)).slice(0, 200)}</div>`
            : '';
        return `<div class="field ${isOverridden ? 'changed' : ''}" data-field-wrap="${f.key}">
            <label>${escapeHtml(f.label)}</label>
            ${input}
            ${hint}
            ${orig}
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="editor-form">${fields}</div>
        <div class="editor-actions">
            <button type="button" class="btn-primary" id="btn-save-movie">Сохранить</button>
            <button type="button" class="ghost" id="btn-cancel-movie">Отменить изменения</button>
            <button type="button" class="btn-danger" id="btn-clear-overrides">Сбросить все правки</button>
        </div>
        <div class="editor-status" id="editor-status"></div>
        <div id="trailer-preview-wrap"></div>
    `;
    $('btn-save-movie').addEventListener('click', () => saveMovieEditor(data));
    $('btn-cancel-movie').addEventListener('click', () => renderEditorForm(data));
    $('btn-clear-overrides').addEventListener('click', () => clearAllOverrides(data.movieId));
    body.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', updateTrailerPreview));
    updateTrailerPreview();
}

function normalizeTrailerUrl(raw) {
    // Синхронизировано с backend/overrides_service.py::normalize_trailer_url.
    // Обычную страницу RuTube (/video/{id}/) приводим к embed-плееру.
    if (!raw) return raw;
    const s = String(raw).trim();
    const m = s.match(/^https?:\/\/(?:www\.)?rutube\.ru\/(?:video(?:\/private)?\/([A-Za-z0-9_-]+)|play\/embed\/([A-Za-z0-9_-]+))\/?/i);
    if (m) {
        const id = m[1] || m[2];
        if (id) return `https://rutube.ru/play/embed/${id}`;
    }
    return s;
}

function updateTrailerPreview() {
    const wrap = $('trailer-preview-wrap');
    if (!wrap) return;
    const urlEl = document.querySelector('[data-field="trailerUrl"]');
    const raw = (urlEl?.value || '').trim();
    if (!raw) { wrap.innerHTML = ''; return; }
    const url = normalizeTrailerUrl(raw);
    // Если пользователь вставил обычную страницу — тихо подставим embed в поле,
    // чтобы форма сохранила корректный URL (плюс превью его показало).
    if (url !== raw && urlEl) urlEl.value = url;
    const safe = escapeHtml(url);
    const note = url !== raw
        ? '<div class="hint">Ссылка автоматически приведена к встраиваемому плееру.</div>'
        : '';
    wrap.innerHTML = `<div class="trailer-preview">Превью трейлера:${note}<iframe src="${safe}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
}

async function saveMovieEditor(data) {
    const status = $('editor-status');
    status.textContent = 'Сохраняем…';
    status.className = 'editor-status';
    const fields = {};
    document.querySelectorAll('[data-field]').forEach((el) => { fields[el.dataset.field] = el.value; });
    try {
        const resp = await adminFetch(`/api/admin/movie/${data.movieId}`, {
            method: 'PUT',
            body: JSON.stringify({ fields })
        });
        status.textContent = 'Сохранено ✓';
        status.className = 'editor-status ok';
        // Обновим локальный override, чтобы «Ориг.» показывался корректно.
        catalogState.currentData.override = resp.override || {};
        renderEditor(catalogState.currentData);
    } catch (err) {
        status.textContent = 'Ошибка: ' + err.message;
        status.className = 'editor-status err';
    }
}

async function clearAllOverrides(id) {
    if (!confirm('Сбросить все правки этого фильма? Данные вернутся к исходным.')) return;
    const status = $('editor-status');
    try {
        await adminFetch(`/api/admin/movie/${id}/overrides`, { method: 'DELETE' });
        openMovieEditor(id);
    } catch (err) {
        if (status) { status.textContent = 'Ошибка: ' + err.message; status.className = 'editor-status err'; }
    }
}

async function renderEditorHistory(id) {
    const body = $('editor-body');
    body.innerHTML = '<div class="muted">Загрузка истории…</div>';
    try {
        const data = await adminFetch(`/api/admin/movie/${id}/history`);
        const items = data.items || [];
        if (!items.length) {
            body.innerHTML = '<div class="editor-empty">История пуста — этот фильм ещё ни разу не редактировали.</div>';
            return;
        }
        body.innerHTML = '<div class="history-list">' + items.map((h) => renderHistoryItem(h)).join('') + '</div>';
        body.querySelectorAll('[data-revert]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Откатить фильм к этой версии?')) return;
                try {
                    await adminFetch(`/api/admin/movie/${id}/revert`, {
                        method: 'POST',
                        body: JSON.stringify({ versionId: btn.dataset.revert })
                    });
                    // Возвращаемся на вкладку «Редактирование» с обновлёнными данными.
                    catalogState.editorTab = 'edit';
                    openMovieEditor(id);
                } catch (err) {
                    alert('Не удалось откатить: ' + err.message);
                }
            });
        });
    } catch (err) {
        body.innerHTML = `<div class="error-hint">${escapeHtml(err.message)}</div>`;
    }
}

function renderHistoryItem(h) {
    const date = h.timestamp ? new Date(h.timestamp).toLocaleString('ru') : '—';
    const after = h.after || {};
    const before = h.before || {};
    const changedKeys = new Set([...Object.keys(after), ...Object.keys(before)]);
    const diff = [...changedKeys].map((k) => {
        const b = before[k]; const a = after[k];
        if (JSON.stringify(a) === JSON.stringify(b)) return null;
        const bs = b === undefined ? '∅' : truncate(stringify(b), 80);
        const as = a === undefined ? '∅ (снят)' : truncate(stringify(a), 80);
        return `${k}: ${bs} → ${as}`;
    }).filter(Boolean).join('\n');
    const author = h.adminEmail ? ` · ${escapeHtml(h.adminEmail)}` : '';
    const reverted = h.reverted_from ? ' <span class="bug-reason-chip">откат</span>' : '';
    return `<div class="history-item">
        <div class="history-head">
            <div class="history-time">${escapeHtml(date)}${author}${reverted}</div>
            <button class="ghost" data-revert="${escapeHtml(h.id)}">Откатить сюда</button>
        </div>
        <div class="history-changes">${escapeHtml(diff || '(без изменений)')}</div>
    </div>`;
}

function stringify(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
}
function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

// ---- Data cache ----
let usersCache = null;      // [{uid, createdAt(Date|null), lastActiveAt(Date|null), email, watchlist:[], liked:[], watched:[]}]
let bugsCache = null;       // [{id, ...}]

async function loadUsers() {
    if (usersCache) return usersCache;
    const snap = await getDocs(collection(db, 'users'));
    const out = [];
    snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        out.push({
            uid: docSnap.id,
            email: d.email || '',
            displayName: d.displayName || '',
            createdAt: tsToDate(d.createdAt),
            lastActiveAt: tsToDate(d.lastActiveAt),
            watchlist: Array.isArray(d.watchlist) ? d.watchlist : (Array.isArray(d.favorites) ? d.favorites : []),
            liked: Array.isArray(d.liked) ? d.liked : [],
            watched: Array.isArray(d.watched) ? d.watched : []
        });
    });
    usersCache = out;
    return out;
}

async function loadAllBugs(force) {
    if (bugsCache && !force) return bugsCache;
    // Пытаемся сортировать по дате (потребует индекс — но одиночный orderBy Firestore разрешает без индекса)
    let items = [];
    try {
        const snap = await getDocs(query(collection(db, 'bug_reports'), orderBy('createdAt', 'desc'), fbLimit(500)));
        snap.forEach((d) => items.push({ id: d.id, ...d.data(), createdAt: tsToDate(d.data().createdAt) }));
    } catch (err) {
        // Falls back to unsorted read.
        const snap = await getDocs(collection(db, 'bug_reports'));
        snap.forEach((d) => items.push({ id: d.id, ...d.data(), createdAt: tsToDate(d.data().createdAt) }));
        items.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    }
    bugsCache = items;
    return items;
}

function tsToDate(v) {
    if (!v) return null;
    if (v instanceof Timestamp) return v.toDate();
    if (typeof v?.toDate === 'function') return v.toDate();
    if (v?.seconds) return new Date(v.seconds * 1000);
    if (v instanceof Date) return v;
    return null;
}

function daysAgo(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n + 1);
    return d;
}

function count(arr, from) {
    return arr.filter((d) => d && d.getTime() >= from.getTime()).length;
}

// ---- Boot & tab loaders ----
async function bootDashboard() {
    usersCache = null;
    bugsCache = null;
    loadOverview();
}

async function loadOverview() {
    try {
        const users = await loadUsers();
        const bugs = await loadAllBugs();
        const from1 = daysAgo(1);
        const bugsNew = bugs.filter((b) => (b.status || 'new') === 'new').length;
        $('k-users').textContent = users.length;
        $('k-new-1').textContent = count(users.map((u) => u.createdAt), from1);
        $('k-active-1').textContent = count(users.map((u) => u.lastActiveAt), from1);
        $('k-bugs-new').textContent = bugsNew;
        updateBugsBadge();

        const highlights = [];
        const totalFav = users.reduce((s, u) => s + (u.watchlist?.length || 0), 0);
        const totalLiked = users.reduce((s, u) => s + (u.liked?.length || 0), 0);
        const totalWatched = users.reduce((s, u) => s + (u.watched?.length || 0), 0);
        highlights.push(`Всего добавлений в «Хочу посмотреть»: <b>${totalFav}</b>`);
        highlights.push(`Всего «Нравится»: <b>${totalLiked}</b>`);
        highlights.push(`Всего «Просмотрено»: <b>${totalWatched}</b>`);
        highlights.push(`Ошибок за всё время: <b>${bugs.length}</b>`);
        $('overview-highlights').innerHTML = highlights.map((h) => `<li>${h}</li>`).join('');
    } catch (err) {
        console.error(err);
        ['k-users', 'k-new-1', 'k-active-1', 'k-bugs-new'].forEach((id) => { $(id).textContent = '—'; });
        $('overview-highlights').innerHTML = `<li class="error-hint">${describeFsError(err)}</li>`;
    }
}

function describeFsError(err) {
    const code = err?.code || '';
    if (code === 'permission-denied' || String(err).includes('permission')) {
        return 'Нет доступа к базе. Опубликуйте правила Firestore (файл firestore.rules) в Firebase Console → Firestore Database → Rules → Publish.';
    }
    if (code === 'unavailable' || String(err).includes('offline')) {
        return 'Firestore недоступен. Проверьте интернет и попробуйте снова.';
    }
    return 'Ошибка загрузки: ' + (err?.message || err);
}

async function loadStats() {
    try {
        const users = await loadUsers();
        const regs = users.map((u) => u.createdAt);
        const acts = users.map((u) => u.lastActiveAt);
        const periods = [1, 3, 7, 30];
        periods.forEach((p) => {
            const from = daysAgo(p);
            $(`reg-${p}`).textContent = count(regs, from);
            $(`act-${p}`).textContent = count(acts, from);
        });
    } catch (err) {
        console.error(err);
        ['reg-1', 'reg-3', 'reg-7', 'reg-30', 'act-1', 'act-3', 'act-7', 'act-30'].forEach((id) => { $(id).textContent = '—'; });
        alert(describeFsError(err));
    }
}

async function loadTrends() {
    try {
        const users = await loadUsers();
        // Считаем: сколько раз каждый movieId встречается в watchlist/liked/watched у всех пользователей.
        const combined = new Map();
        const watchlist = new Map();
        users.forEach((u) => {
            (u.watchlist || []).forEach((id) => bump(combined, id) && bump(watchlist, id));
            (u.liked || []).forEach((id) => bump(combined, id));
            (u.watched || []).forEach((id) => bump(combined, id));
        });
        const topCombined = [...combined.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
        const topWatchlist = [...watchlist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

        renderTrendList('trend-movies', topCombined);
        renderTrendList('trend-watchlist', topWatchlist);

        // Жанры — потянем детали через бэкенд для первых ~25 самых частых.
        const topIds = [...combined.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([id]) => id);
        const genreCounts = new Map();
        const details = await Promise.all(topIds.map((id) => fetchMovieBrief(id)));
        details.forEach((m, i) => {
            if (!m) return;
            const weight = combined.get(topIds[i]) || 1;
            (m.genres || []).forEach((g) => {
                const name = (g && g.genre) || (typeof g === 'string' ? g : '');
                if (!name) return;
                genreCounts.set(name, (genreCounts.get(name) || 0) + weight);
            });
        });
        const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        const g = $('trend-genres');
        g.innerHTML = topGenres.length
            ? topGenres.map(([name, n]) => `<li>${escapeHtml(name)}<span class="trend-count">${n}</span></li>`).join('')
            : '<li class="muted">Пока нет данных</li>';

        async function renderMovies(id) {
            const m = await fetchMovieBrief(id);
            if (!m) return `#${id}`;
            const y = m.year ? ` (${m.year})` : '';
            const name = m.nameRu || m.nameEn || m.nameOriginal || `#${id}`;
            return `${escapeHtml(name)}${escapeHtml(y)}`;
        }
        // Замещаем плейсхолдеры с id -> названиями (второй проход, чтобы не блокировать первичный рендер).
        for (const listId of ['trend-movies', 'trend-watchlist']) {
            const el = $(listId);
            const items = el.querySelectorAll('li[data-id]');
            for (const li of items) {
                const id = Number(li.dataset.id);
                const label = await renderMovies(id);
                const cnt = li.querySelector('.trend-count')?.outerHTML || '';
                li.innerHTML = `${label}${cnt}`;
            }
        }
    } catch (err) {
        console.error(err);
        ['trend-movies', 'trend-genres', 'trend-watchlist'].forEach((id) => {
            $(id).innerHTML = `<li class="muted">Ошибка: ${err.message}</li>`;
        });
    }
}

function bump(map, id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return false;
    map.set(n, (map.get(n) || 0) + 1);
    return true;
}

function renderTrendList(elId, entries) {
    const el = $(elId);
    if (!entries.length) { el.innerHTML = '<li class="muted">Пока нет данных</li>'; return; }
    el.innerHTML = entries.map(([id, n]) =>
        `<li data-id="${id}">#${id}<span class="trend-count">${n}</span></li>`
    ).join('');
}

const movieDetailsCache = new Map();
async function fetchMovieBrief(id) {
    if (movieDetailsCache.has(id)) return movieDetailsCache.get(id);
    try {
        const r = await fetch(`${BACKEND_ORIGIN}/api/movies/${id}`, { cache: 'force-cache' });
        if (!r.ok) throw new Error('http ' + r.status);
        const d = await r.json();
        movieDetailsCache.set(id, d);
        return d;
    } catch {
        movieDetailsCache.set(id, null);
        return null;
    }
}

async function loadSystem() {
    const setDot = (el, ok) => { el.classList.remove('ok', 'warn', 'err'); el.classList.add(ok ? 'ok' : 'err'); };
    try {
        const r = await fetch(`${BACKEND_ORIGIN}/health`);
        const ok = r.ok;
        const data = ok ? await r.json() : null;
        setDot($('sys-server'), ok);
        $('sys-server').textContent = ok ? 'Работает' : 'Недоступен';
        setDot($('sys-catalog'), !!(data && data.catalog_available));
        $('sys-catalog').textContent = data && data.catalog_available ? `Загружен (${data.catalog_size || 0})` : 'Не загружен';
        setDot($('sys-kp'), !!(data && data.has_api_key));
        $('sys-kp').textContent = data && data.has_api_key ? 'Есть' : 'Нет ключа';
        $('sys-raw').textContent = JSON.stringify(data || { ok: false }, null, 2);
    } catch (err) {
        setDot($('sys-server'), false);
        $('sys-server').textContent = 'Ошибка';
        $('sys-raw').textContent = err.message;
    }
    // Проверяем БД (Firestore) — простой read на users.
    try {
        await getCountFromServer(collection(db, 'users'));
        $('sys-db').textContent = 'Работает';
        setDot($('sys-db'), true);
    } catch (err) {
        $('sys-db').textContent = 'Ошибка чтения';
        setDot($('sys-db'), false);
    }
    // Критические ошибки — если сервер отвечает и БД доступна, показываем «нет».
    const ce = $('sys-errors');
    const serverOk = $('sys-server').textContent === 'Работает';
    const dbOk = $('sys-db').textContent === 'Работает';
    if (serverOk && dbOk) { ce.textContent = 'Критических ошибок не обнаружено.'; ce.classList.remove('muted'); ce.classList.add('ok'); }
    else { ce.textContent = 'Есть проблемы (см. детали ниже).'; ce.classList.remove('ok'); ce.classList.add('muted'); }
}

// ---- Bugs ----
const bugFilters = { search: '', status: '', reason: '' };
['bug-search'].forEach((id) => $(id).addEventListener('input', (e) => { bugFilters.search = e.target.value.trim().toLowerCase(); renderBugs(); }));
$('bug-filter-status').addEventListener('change', (e) => { bugFilters.status = e.target.value; renderBugs(); });
$('bug-filter-reason').addEventListener('change', (e) => { bugFilters.reason = e.target.value; renderBugs(); });

async function loadBugs() {
    try {
        await loadAllBugs(true);
        renderBugs();
    } catch (err) {
        $('bug-list').innerHTML = `<div class="error-hint">${describeFsError(err)}</div>`;
    }
}

const REASON_LABEL = {
    wrong_trailer: 'Неверный трейлер',
    trailer_not_playing: 'Трейлер не воспроизводится',
    wrong_description: 'Неверное описание',
    wrong_poster: 'Неправильный постер',
    wrong_data: 'Ошибка в информации',
    other: 'Другое'
};

function renderBugs() {
    const list = bugsCache || [];
    const filtered = list.filter((b) => {
        if (bugFilters.status && (b.status || 'new') !== bugFilters.status) return false;
        if (bugFilters.reason && b.reason !== bugFilters.reason) return false;
        if (bugFilters.search) {
            const hay = `${b.movieTitle || ''} ${b.comment || ''} ${b.userEmail || ''} ${b.userName || ''}`.toLowerCase();
            if (!hay.includes(bugFilters.search)) return false;
        }
        return true;
    });
    const el = $('bug-list');
    if (!filtered.length) { el.innerHTML = '<div class="muted">Ничего не найдено.</div>'; return; }
    el.innerHTML = filtered.map((b) => renderBugCard(b)).join('');
    // Кликабельные чипы статусов — не даём событию всплыть до карточки,
    // чтобы клик по «В работе» не бросал одновременно в редактор.
    el.querySelectorAll('.status-chip').forEach((chip) => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            setBugStatus(chip.dataset.bug, chip.dataset.status);
        });
    });
    // Кликабельная карточка и название → открыть фильм в «Каталоге».
    el.querySelectorAll('[data-open-movie]').forEach((node) => {
        node.addEventListener('click', (e) => {
            const id = Number(node.dataset.openMovie);
            if (!Number.isFinite(id) || id <= 0) return;
            e.stopPropagation();
            openMovieFromBug(id, node.dataset.movieTitle || '');
        });
    });
    updateBugsBadge();
}

function renderBugCard(b) {
    const y = b.movieYear ? `<span class="bug-year">${escapeHtml(b.movieYear)}</span>` : '';
    const reason = REASON_LABEL[b.reason] || b.reason || 'Другое';
    const status = b.status || 'new';
    const chip = (val, label) => `<button class="status-chip ${status === val ? 'active' : ''}" data-bug="${b.id}" data-status="${val}">${label}</button>`;
    const date = b.createdAt ? b.createdAt.toLocaleString('ru') : '—';
    const hasMovieId = Number.isFinite(Number(b.movieId)) && Number(b.movieId) > 0;
    const idChip = hasMovieId
        ? `<a href="#" class="bug-id-link" data-open-movie="${b.movieId}" data-movie-title="${escapeHtml(b.movieTitle || '')}">#${b.movieId}</a>`
        : `#${b.movieId || '?'}`;
    const metaBase = [date, b.userEmail || 'без email', b.appVersion ? `v${escapeHtml(b.appVersion)}` : ''].filter(Boolean).join(' · ');
    const comment = b.comment ? `<div class="bug-comment">${escapeHtml(b.comment)}</div>` : '';
    const titleAttrs = hasMovieId ? `class="bug-title clickable" data-open-movie="${b.movieId}" data-movie-title="${escapeHtml(b.movieTitle || '')}" role="link" title="Открыть в каталоге для правки"` : 'class="bug-title"';
    const openHint = hasMovieId ? '<div class="bug-open-hint">Нажмите на название или ID, чтобы открыть фильм в каталоге</div>' : '';
    return `
        <article class="bug-card">
          <div class="bug-head">
            <span ${titleAttrs}>${escapeHtml(b.movieTitle || '—')}</span>
            ${y}
            <span class="bug-reason-chip">${escapeHtml(reason)}</span>
          </div>
          <div class="bug-meta">${idChip} · ${escapeHtml(metaBase)}</div>
          ${comment}
          ${openHint}
          <div class="bug-actions">
            ${chip('new', 'Новое')}
            ${chip('in_progress', 'В работе')}
            ${chip('fixed', 'Исправлено')}
          </div>
        </article>`;
}

// Из «Ошибок» → в «Каталог» с заранее подставленным фильмом.
function openMovieFromBug(movieId, movieTitle) {
    switchTab('catalog');
    // Гарантируем, что вкладка Каталог инициализирована (обработчики поиска).
    initCatalogTab();
    const input = document.getElementById('catalog-search');
    if (input) input.value = movieTitle ? movieTitle : String(movieId);
    // Показываем в списке результатов маркер, что фильм открыт по ID.
    const list = document.getElementById('catalog-results');
    if (list) {
        list.innerHTML = `<div class="catalog-result active" data-id="${movieId}">
            <div class="catalog-result-body">
                <div class="catalog-result-title">${escapeHtml(movieTitle || 'Фильм')}</div>
                <div class="catalog-result-meta">#${movieId} · открыт из «Ошибок»</div>
            </div>
        </div>`;
    }
    openMovieEditor(movieId);
}

// Красный бейдж «Новых» ошибок в sidebar-меню.
function updateBugsBadge() {
    const badge = $('bugs-badge');
    if (!badge) return;
    const list = bugsCache || [];
    const newCount = list.filter((b) => (b.status || 'new') === 'new').length;
    if (newCount > 0) {
        badge.textContent = newCount > 99 ? '99+' : String(newCount);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

async function setBugStatus(id, status) {
    try {
        await updateDoc(doc(db, 'bug_reports', id), { status });
        const b = bugsCache.find((x) => x.id === id);
        if (b) b.status = status;
        renderBugs();
    } catch (err) {
        alert('Не удалось обновить статус: ' + err.message);
    }
}

// ---- utils ----
function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// PWA: Service Worker + install prompt
// Позволяет админ-панели «поставиться» на телефон как обычное
// приложение (иконка на рабочем столе, отдельное окно без UI браузера).
// ============================================================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/admin/sw.js').catch((err) => {
            console.warn('SW register failed:', err);
        });
    });
}

// Chrome/Android: ловим beforeinstallprompt и показываем свою кнопку.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.hidden = false;
});

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-install-pwa');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        // Chrome: используем сохранённый prompt.
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            try { await deferredInstallPrompt.userChoice; } catch {}
            deferredInstallPrompt = null;
            btn.hidden = true;
            return;
        }
        // iOS Safari: prompt API нет — покажем инструкцию.
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            alert('Чтобы установить приложение на iPhone:\n\n' +
                  '1. Нажмите кнопку «Поделиться» (квадрат со стрелкой) внизу Safari.\n' +
                  '2. Прокрутите вниз и выберите «На экран Домой».\n' +
                  '3. Нажмите «Добавить».\n\n' +
                  'Иконка «FF Admin» появится на рабочем столе.');
        } else {
            alert('Откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран».');
        }
    });
});

// Если приложение уже установлено — событие срабатывает и мы прячем кнопку.
window.addEventListener('appinstalled', () => {
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.hidden = true;
    deferredInstallPrompt = null;
});

// На iOS отдельно: если не в standalone-режиме и это iOS — тоже покажем кнопку,
// потому что beforeinstallprompt там не срабатывает.
(function showIOSInstallHint() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isIOS && !isStandalone) {
        document.addEventListener('DOMContentLoaded', () => {
            const btn = document.getElementById('btn-install-pwa');
            if (btn) btn.hidden = false;
        });
    }
})();
