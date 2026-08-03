/* ============================================================
   FeelFilm — Логика приложения
   Firebase Auth + Firestore + Kinopoisk API
   ============================================================ */

// =====================================================
// Firebase SDK (v10+ modular, через CDN ESM)
// =====================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    setPersistence,
    browserLocalPersistence,
    inMemoryPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    arrayUnion,
    arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// =====================================================
// ⚠️  FIREBASE CONFIG — ВСТАВЬ СВОИ ДАННЫЕ  ⚠️
// Получить config можно в Firebase Console:
// Project Settings -> General -> Your apps -> Web app
// =====================================================
const firebaseConfig = {
    apiKey: "AIzaSyDHa1gPxZyYPNEcE69BZF9fqogOtMvofhk",
    authDomain: "feelfilm-13a52.firebaseapp.com",
    projectId: "feelfilm-13a52",
    storageBucket: "feelfilm-13a52.firebasestorage.app",
    messagingSenderId: "524135203863",
    appId: "1:524135203863:web:10214378248da788ac4852"
};
// =====================================================
const BACKEND_DIRECT_URL = 'http://185.73.126.11:8000';
// Основной путь — через WebView-прокси (нативная сторона проксирует запросы к
// бэкенду и добавляет заголовки). Работает для GET, но НЕ передаёт тело POST
// (ограничение WebResourceRequest в Android), поэтому POST-эндпоинты вызываем
// напрямую через BACKEND_DIRECT_URL — см. использования ниже.
const BACKEND_API_BASE = window.location.hostname === 'appassets.androidplatform.net'
    ? 'https://appassets.androidplatform.net/api-proxy'
    : BACKEND_DIRECT_URL;
// Прямой URL для POST-запросов с телом (JSON). В web-режиме совпадает с прокси.
const BACKEND_POST_BASE = window.location.hostname === 'appassets.androidplatform.net'
    ? BACKEND_DIRECT_URL
    : BACKEND_DIRECT_URL;

// Централизованные настройки служебных ссылок и метаданных приложения.
const APP_RUNTIME_CONFIG = {
    appName: 'FeelFilm',
    appDescription: 'Приложение для подбора фильмов в формате живой ленты.\n\nСохраняйте интересные фильмы,\nотмечайте просмотренные\nи находите, что посмотреть дальше.',
    appVersion: '1.0.0',
    privacyPolicyUrl: 'https://nazimaov.github.io/feelfilm-privacy/',
    contactEmail: 'feelfilmsupport@gmail.com',
    contactSubject: 'FeelFilms — обратная связь'
};

// --- Инициализация Firebase ---
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Auth persistence fallback to inMemory:', err);
    return setPersistence(auth, inMemoryPersistence);
});

// --- Маппинг настроений на жанры КиноПоиска ---
const CATEGORY_DEFINITIONS = [
    { id: 'all', label: '\u0412\u0441\u0435', icon: '\uD83C\uDFAD', keywords: [], contentType: 'ALL' },
    { id: 'comedy', label: '\u041A\u043E\u043C\u0435\u0434\u0438\u044F', icon: '\uD83D\uDE02', keywords: ['\u043A\u043E\u043C\u0435\u0434'], contentType: 'FILM' },
    { id: 'horror', label: '\u0423\u0436\u0430\u0441\u044B', icon: '\uD83D\uDC7B', keywords: ['\u0443\u0436\u0430\u0441'], contentType: 'FILM' },
    { id: 'action', label: '\u042D\u043A\u0448\u043D', icon: '\uD83D\uDCA5', keywords: ['\u0431\u043E\u0435\u0432\u0438\u043A', '\u044D\u043A\u0448\u043D'], contentType: 'FILM' },
    { id: 'thriller', label: '\u0422\u0440\u0438\u043B\u043B\u0435\u0440', icon: '\uD83D\uDD75\uFE0F', keywords: ['\u0442\u0440\u0438\u043B\u043B\u0435\u0440'], contentType: 'FILM' },
    { id: 'detective', label: '\u0414\u0435\u0442\u0435\u043A\u0442\u0438\u0432', icon: '\uD83E\uDDE9', keywords: ['\u0434\u0435\u0442\u0435\u043A\u0442\u0438\u0432'], contentType: 'FILM' },
    { id: 'fantasy', label: '\u0424\u0430\u043D\u0442\u0430\u0441\u0442\u0438\u043A\u0430', icon: '\uD83D\uDE80', keywords: ['\u0444\u0430\u043D\u0442\u0430\u0441\u0442'], contentType: 'FILM' },
    { id: 'fantasy_world', label: '\u0424\u044D\u043D\u0442\u0435\u0437\u0438', icon: '\uD83D\uDC09', keywords: ['\u0444\u044D\u043D\u0442\u0435\u0437\u0438'], contentType: 'FILM' },
    { id: 'drama', label: '\u0414\u0440\u0430\u043C\u0430', icon: '\uD83C\uDFAC', keywords: ['\u0434\u0440\u0430\u043C\u0430'], contentType: 'FILM' },
    { id: 'romance', label: '\u0420\u043E\u043C\u0430\u043D\u0442\u0438\u043A\u0430', icon: '\uD83D\uDC9E', keywords: ['\u043C\u0435\u043B\u043E\u0434\u0440\u0430\u043C', '\u0440\u043E\u043C\u0430\u043D\u0442'], contentType: 'FILM' },
    { id: 'adventure', label: '\u041F\u0440\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F', icon: '\uD83E\uDDED', keywords: ['\u043F\u0440\u0438\u043A\u043B\u044E\u0447'], contentType: 'FILM' },
    { id: 'family', label: '\u0421\u0435\u043C\u0435\u0439\u043D\u043E\u0435', icon: '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67', keywords: ['\u0441\u0435\u043C\u0435\u0439\u043D', '\u0434\u0435\u0442\u0441\u043A'], contentType: 'FILM' },
    { id: 'crime', label: '\u041A\u0440\u0438\u043C\u0438\u043D\u0430\u043B', icon: '\uD83D\uDEA8', keywords: ['\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u043B'], contentType: 'FILM' },
    { id: 'mystic', label: '\u041C\u0438\u0441\u0442\u0438\u043A\u0430', icon: '\uD83C\uDF2B\uFE0F', keywords: ['\u043C\u0438\u0441\u0442\u0438\u043A'], contentType: 'FILM' },
    { id: 'anime', label: '\u0410\u043D\u0438\u043C\u0435', icon: '\uD83C\uDF38', keywords: ['\u0430\u043D\u0438\u043C\u0435'], contentType: 'FILM' },
    { id: 'cartoon', label: '\u041C\u0443\u043B\u044C\u0442\u0444\u0438\u043B\u044C\u043C\u044B', icon: '\uD83E\uDDF8', keywords: ['\u043C\u0443\u043B\u044C\u0442', '\u0430\u043D\u0438\u043C\u0430\u0446'], contentType: 'CARTOON' },
    { id: 'documentary', label: '\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u043B\u044C\u043D\u043E\u0435', icon: '\uD83C\uDFA5', keywords: ['\u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442'], contentType: 'FILM' },
    { id: 'history', label: '\u0418\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u043E\u0435', icon: '\uD83C\uDFDB\uFE0F', keywords: ['\u0438\u0441\u0442\u043E\u0440'], contentType: 'FILM' },
    { id: 'psychological', label: '\u041F\u0441\u0438\u0445\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u043E\u0435', icon: '\uD83E\uDDE0', keywords: ['\u043F\u0441\u0438\u0445\u043E\u043B\u043E\u0433'], contentType: 'FILM' },
    { id: 'series', label: '\u0421\u0435\u0440\u0438\u0430\u043B\u044B', icon: '\uD83D\uDCFA', keywords: ['\u0441\u0435\u0440\u0438\u0430\u043B'], contentType: 'TV_SERIES' },
    { id: 'short', label: '\u041A\u043E\u0440\u043E\u0442\u043A\u043E\u043C\u0435\u0442\u0440\u0430\u0436\u043A\u0438', icon: '\u23F1\uFE0F', keywords: ['\u043A\u043E\u0440\u043E\u0442\u043A\u043E\u043C\u0435\u0442\u0440\u0430\u0436'], contentType: 'FILM' }
];

const CATEGORY_BY_ID = new Map(CATEGORY_DEFINITIONS.map((category) => [category.id, category]));
const DESCRIPTION_PLACEHOLDER = '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442';
const DESCRIPTION_FALLBACK = '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0435.';
const COUNTRY_CODE_BY_NAME = {
    'россия': 'RU',
    'рф': 'RU',
    'сша': 'US',
    'америка': 'US',
    'соединенные штаты': 'US',
    'соединённые штаты': 'US',
    'соединенные штаты америки': 'US',
    'соединённые штаты америки': 'US',
    'великобритания': 'GB',
    'англия': 'GB',
    'соединенное королевство': 'GB',
    'соединённое королевство': 'GB',
    'британия': 'GB',
    'франция': 'FR',
    'германия': 'DE',
    'фрг': 'DE',
    'италия': 'IT',
    'испания': 'ES',
    'япония': 'JP',
    'корея': 'KR',
    'южная корея': 'KR',
    'корея южная': 'KR',
    'северная корея': 'KP',
    'корея северная': 'KP',
    'китай': 'CN',
    'гонконг': 'HK',
    'тайвань': 'TW',
    'индия': 'IN',
    'турция': 'TR',
    'швеция': 'SE',
    'норвегия': 'NO',
    'дания': 'DK',
    'финляндия': 'FI',
    'исландия': 'IS',
    'ирландия': 'IE',
    'нидерланды': 'NL',
    'голландия': 'NL',
    'бельгия': 'BE',
    'швейцария': 'CH',
    'австрия': 'AT',
    'португалия': 'PT',
    'греция': 'GR',
    'румыния': 'RO',
    'болгария': 'BG',
    'венгрия': 'HU',
    'сербия': 'RS',
    'хорватия': 'HR',
    'словения': 'SI',
    'словакия': 'SK',
    'литва': 'LT',
    'латвия': 'LV',
    'эстония': 'EE',
    'беларусь': 'BY',
    'казахстан': 'KZ',
    'грузия': 'GE',
    'армения': 'AM',
    'азербайджан': 'AZ',
    'узбекистан': 'UZ',
    'израиль': 'IL',
    'оаэ': 'AE',
    'саудовская аравия': 'SA',
    'египет': 'EG',
    'марокко': 'MA',
    'юар': 'ZA',
    'нигерия': 'NG',
    'аргентина': 'AR',
    'чили': 'CL',
    'колумбия': 'CO',
    'перу': 'PE',
    'венесуэла': 'VE',
    'польша': 'PL',
    'чехия': 'CZ',
    'украина': 'UA',
    'бразилия': 'BR',
    'канада': 'CA',
    'австралия': 'AU',
    'новая зеландия': 'NZ',
    'таиланд': 'TH',
    'тайланд': 'TH',
    'вьетнам': 'VN',
    'сингапур': 'SG',
    'малайзия': 'MY',
    'индонезия': 'ID',
    'филиппины': 'PH',
    'пакистан': 'PK',
    'бангладеш': 'BD',
    'шри-ланка': 'LK',
    'монголия': 'MN',
    'непал': 'NP',
    'мексика': 'MX',
    'new zealand': 'NZ',
    'usa': 'US',
    'uk': 'GB',
    'united states': 'US',
    'united states of america': 'US',
    'united kingdom': 'GB',
    'england': 'GB',
    'france': 'FR',
    'germany': 'DE',
    'italy': 'IT',
    'spain': 'ES',
    'japan': 'JP',
    'korea': 'KR',
    'south korea': 'KR',
    'north korea': 'KP',
    'china': 'CN',
    'hong kong': 'HK',
    'taiwan': 'TW',
    'india': 'IN',
    'turkey': 'TR',
    'sweden': 'SE',
    'norway': 'NO',
    'denmark': 'DK',
    'finland': 'FI',
    'iceland': 'IS',
    'ireland': 'IE',
    'netherlands': 'NL',
    'belgium': 'BE',
    'switzerland': 'CH',
    'austria': 'AT',
    'portugal': 'PT',
    'greece': 'GR',
    'romania': 'RO',
    'bulgaria': 'BG',
    'hungary': 'HU',
    'serbia': 'RS',
    'croatia': 'HR',
    'slovenia': 'SI',
    'slovakia': 'SK',
    'lithuania': 'LT',
    'latvia': 'LV',
    'estonia': 'EE',
    'belarus': 'BY',
    'kazakhstan': 'KZ',
    'georgia': 'GE',
    'armenia': 'AM',
    'azerbaijan': 'AZ',
    'uzbekistan': 'UZ',
    'israel': 'IL',
    'uae': 'AE',
    'saudi arabia': 'SA',
    'egypt': 'EG',
    'morocco': 'MA',
    'south africa': 'ZA',
    'nigeria': 'NG',
    'poland': 'PL',
    'czech republic': 'CZ',
    'ukraine': 'UA',
    'brazil': 'BR',
    'canada': 'CA',
    'australia': 'AU',
    'thailand': 'TH',
    'vietnam': 'VN',
    'singapore': 'SG',
    'malaysia': 'MY',
    'indonesia': 'ID',
    'philippines': 'PH',
    'pakistan': 'PK',
    'bangladesh': 'BD',
    'sri lanka': 'LK',
    'mongolia': 'MN',
    'nepal': 'NP',
    'argentina': 'AR',
    'chile': 'CL',
    'colombia': 'CO',
    'peru': 'PE',
    'venezuela': 'VE',
    'mexico': 'MX'
};
const COUNTRY_FILTER_OPTIONS = [
    { name: 'США', flag: '🇺🇸' },
    { name: 'Россия', flag: '🇷🇺' },
    { name: 'Великобритания', flag: '🇬🇧' },
    { name: 'Франция', flag: '🇫🇷' },
    { name: 'Германия', flag: '🇩🇪' },
    { name: 'Италия', flag: '🇮🇹' },
    { name: 'Испания', flag: '🇪🇸' },
    { name: 'Япония', flag: '🇯🇵' },
    { name: 'Южная Корея', flag: '🇰🇷' },
    { name: 'Китай', flag: '🇨🇳' },
    { name: 'Индия', flag: '🇮🇳' },
    { name: 'Канада', flag: '🇨🇦' },
    { name: 'Австралия', flag: '🇦🇺' },
    { name: 'Турция', flag: '🇹🇷' },
    { name: 'Польша', flag: '🇵🇱' },
    { name: 'Украина', flag: '🇺🇦' },
    { name: 'Бразилия', flag: '🇧🇷' },
    { name: 'Мексика', flag: '🇲🇽' }
];

// --- Маппинг ошибок Firebase на русский ---
const AUTH_ERRORS = {
    'auth/email-already-in-use': '\u042D\u0442\u043E\u0442 email \u0443\u0436\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D',
    'auth/invalid-email': '\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 email',
    'auth/weak-password': '\u041F\u0430\u0440\u043E\u043B\u044C \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u043F\u0440\u043E\u0441\u0442\u043E\u0439 (\u043C\u0438\u043D. 6 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432)',
    'auth/user-not-found': '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D',
    'auth/wrong-password': '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C',
    'auth/invalid-credential': '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 email \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C',
    'auth/too-many-requests': '\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435',
    'auth/network-request-failed': '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435'
};

function formatAuthError(err) {
    const code = err?.code || 'auth/unknown';
    const message = AUTH_ERRORS[code] || err?.message || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044E';
    return `${message} (${code})`;
}

// --- Состояние приложения ---
const state = {
    user: null,          // Текущий пользователь Firebase
    movies: [],          // Текущий стек карточек
    currentIndex: 0,     // Индекс текущей верхней карточки
    favorites: [],       // Избранные с загруженными деталями
    favoriteIds: new Set(), // Все ID избранных
    favoriteOrderIds: [], // Порядок ID в избранном
    favoriteDetailsById: new Map(), // Детали фильмов по ID
    favoritesVisibleCount: 12,
    favoriteDetailsInFlight: new Set(),
    likedMovies: [],      // Понравившиеся фильмы
    likedIds: new Set(),
    likedOrderIds: [],
    likedDetailsById: new Map(),
    likedVisibleCount: 12,
    likedDetailsInFlight: new Set(),
    watchedMovies: [],
    watchedIds: new Set(),
    watchedOrderIds: [],
    watchedDetailsById: new Map(),
    watchedVisibleCount: 12,
    watchedDetailsInFlight: new Set(),
    skippedIds: new Set(), // Отклоненные фильмы («Пропущенные»)
    skippedMovies: [],
    skippedOrderIds: [],
    skippedDetailsById: new Map(),
    skippedVisibleCount: 12,
    skippedDetailsInFlight: new Set(),
    seenMovieIds: new Set(), // Просмотренные (не показывать повторно)
    allCategories: CATEGORY_DEFINITIONS,
    selectedCategoryIds: new Set(),
    selectedCountry: '',
    preferences: {
        categoryWeights: {},
        typeWeights: {},
        countryWeights: {},
        keywordWeights: {},
        preferredYear: null,
        preferredRating: null
    },
    interactions: {
        likedMovieIds: new Set(),
        dislikedMovieIds: new Set(),
        openedCounts: new Map(),
        shownCounts: new Map(),
        recentShownIds: []
    },
    lastShownMovieId: null,
    page: 1,             // Текущая страница API
    isLoading: false,
    isPrefetching: false,
    currentTab: 'discover'
};

const FAVORITES_CACHE_PREFIX = 'feelfilms_favorites_cache_v2_';
const LIKED_CACHE_PREFIX = 'feelfilms_liked_cache_v1_';
const WATCHED_CACHE_PREFIX = 'feelfilms_watched_cache_v1_';
const SKIPPED_CACHE_PREFIX = 'feelfilms_skipped_cache_v1_';
const DISCOVER_FEED_CACHE_PREFIX = 'feelfilms_discover_feed_v1_';
const FAVORITES_PAGE_SIZE = 12;
const SEEN_MOVIES_CACHE_PREFIX = 'feelfilms_seen_movies_v1_';
const SEEN_MOVIES_MAX = 2000;
const FIRESTORE_TIMEOUT_MS = 8000;
const INTERACTIONS_CACHE_PREFIX = 'feelfilms_interactions_v1_';
const PROFILE_NAME_CACHE_PREFIX = 'feelfilms_profile_name_v1_';
const DISCOVER_FEED_CACHE_TTL_MS = 1000 * 60 * 60 * 18;
const DISCOVER_FEED_CACHE_MAX_MOVIES = 24;
const RECENT_SHOWN_MAX = 120;
const RECENT_SHOWN_PENALTY_WINDOW = 40;
const MAX_OPEN_COUNT_TRACK = 500;

function getFavoritesCacheKey() {
    return state.user ? `${FAVORITES_CACHE_PREFIX}${state.user.uid}` : null;
}

function getLikedCacheKey() {
    return state.user ? `${LIKED_CACHE_PREFIX}${state.user.uid}` : null;
}

function getWatchedCacheKey() {
    return state.user ? `${WATCHED_CACHE_PREFIX}${state.user.uid}` : null;
}

function getSkippedCacheKey() {
    return state.user ? `${SKIPPED_CACHE_PREFIX}${state.user.uid}` : null;
}

function getProfileNameCacheKey(uid = state.user?.uid) {
    return uid ? `${PROFILE_NAME_CACHE_PREFIX}${uid}` : null;
}

function getDiscoverFeedCacheKey() {
    return state.user ? `${DISCOVER_FEED_CACHE_PREFIX}${state.user.uid}` : null;
}

function getDiscoverFilterSignature() {
    const categories = [...state.selectedCategoryIds].sort().join(',');
    const country = normalizeSelectedCountryValue(state.selectedCountry);
    return `${categories}::${country}`;
}

function loadProfileNameCache(uid = state.user?.uid) {
    const key = getProfileNameCacheKey(uid);
    if (!key) return '';
    try {
        const raw = localStorage.getItem(key) || '';
        return raw.trim();
    } catch (err) {
        console.warn('Не удалось прочитать кеш имени профиля:', err);
        return '';
    }
}

function saveProfileNameCache(name, uid = state.user?.uid) {
    const key = getProfileNameCacheKey(uid);
    if (!key) return;
    const normalized = (name || '').toString().trim();
    if (!normalized) return;
    try {
        localStorage.setItem(key, normalized);
    } catch (err) {
        console.warn('Не удалось сохранить кеш имени профиля:', err);
    }
}

function resolveUserDisplayName(user = state.user) {
    const firebaseName = (user?.displayName || '').toString().trim();
    if (firebaseName) {
        saveProfileNameCache(firebaseName, user?.uid);
        return firebaseName;
    }

    const cachedName = loadProfileNameCache(user?.uid);
    if (cachedName) return cachedName;

    const emailLocal = (user?.email || '').split('@')[0].trim();
    if (emailLocal) {
        return emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1);
    }

    return 'Пользователь';
}

function loadDiscoverFeedCache() {
    const key = getDiscoverFeedCacheKey();
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const movies = Array.isArray(parsed.movies) ? parsed.movies : [];
        const page = Number(parsed.page);
        const savedAt = Number(parsed.savedAt);
        const filterSignature = (parsed.filterSignature || '').toString();
        return {
            movies,
            page: Number.isFinite(page) && page > 0 ? page : 1,
            savedAt: Number.isFinite(savedAt) ? savedAt : 0,
            filterSignature
        };
    } catch (err) {
        console.warn('Не удалось прочитать кеш ленты:', err);
        return null;
    }
}

function saveDiscoverFeedCache() {
    const key = getDiscoverFeedCacheKey();
    if (!key) return;

    const remaining = state.movies
        .slice(state.currentIndex)
        .filter((movie) => movie && Number.isFinite(movie.id))
        .slice(0, DISCOVER_FEED_CACHE_MAX_MOVIES);

    if (remaining.length === 0) {
        try {
            localStorage.removeItem(key);
        } catch (err) {
            console.warn('Не удалось очистить кеш ленты:', err);
        }
        return;
    }

    const payload = {
        savedAt: Date.now(),
        page: state.page,
        filterSignature: getDiscoverFilterSignature(),
        movies: remaining
    };

    try {
        localStorage.setItem(key, JSON.stringify(payload));
    } catch (err) {
        console.warn('Не удалось сохранить кеш ленты:', err);
    }
}

function clearDiscoverFeedCache() {
    const key = getDiscoverFeedCacheKey();
    if (!key) return;
    try {
        localStorage.removeItem(key);
    } catch (err) {
        console.warn('Не удалось очистить кеш ленты:', err);
    }
}

function restoreDiscoverFeedFromCache() {
    const cached = loadDiscoverFeedCache();
    if (!cached) return false;
    if (cached.filterSignature !== getDiscoverFilterSignature()) return false;
    if (!cached.savedAt || (Date.now() - cached.savedAt) > DISCOVER_FEED_CACHE_TTL_MS) {
        return false;
    }

    const normalizedMovies = cached.movies
        .map((movie) => normalizeMovie(movie))
        .filter((movie) => Number.isFinite(movie.id));

    if (normalizedMovies.length === 0) return false;

    let movies = filterUnseenMovies(normalizedMovies);
    movies = movies.filter((movie) => isDiscoverCardDisplayable(movie));

    if (movies.length === 0) return false;

    state.page = Math.max(1, cached.page || 1);
    state.movies = hasUserPreferenceSignals()
        ? sortMoviesForUser(movies)
        : sortColdStartMovies(movies);
    state.currentIndex = 0;
    state.lastShownMovieId = null;

    loader.classList.add('hidden');
    loader.style.display = 'none';
    swipeActions.style.display = 'flex';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';

    renderCards();
    return true;
}

function loadFavoritesCache() {
    const key = getFavoritesCacheKey();
    if (!key) return { ids: [], details: {} };
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { ids: [], details: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ids: [], details: {} };
        const ids = Array.isArray(parsed.ids)
            ? parsed.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
            : [];
        const details = parsed.details && typeof parsed.details === 'object' ? parsed.details : {};
        return { ids, details };
    } catch (err) {
        console.warn('Не удалось прочитать кеш избранного:', err);
        return { ids: [], details: {} };
    }
}

function saveFavoritesCache() {
    const key = getFavoritesCacheKey();
    if (!key) return;
    try {
        const details = {};
        state.favoriteDetailsById.forEach((movie, id) => {
            details[id] = movie;
        });
        localStorage.setItem(key, JSON.stringify({
            ids: state.favoriteOrderIds,
            details
        }));
    } catch (err) {
        console.warn('Не удалось сохранить кеш избранного:', err);
    }
}

function syncFavoritesArray() {
    state.favorites = state.favoriteOrderIds
        .map((id) => state.favoriteDetailsById.get(id))
        .filter(Boolean);
}

function syncLikedArray() {
    state.likedMovies = state.likedOrderIds
        .map((id) => state.likedDetailsById.get(id))
        .filter(Boolean);
}

function syncWatchedArray() {
    state.watchedMovies = state.watchedOrderIds
        .map((id) => state.watchedDetailsById.get(id))
        .filter(Boolean);
}

function syncSkippedArray() {
    state.skippedMovies = state.skippedOrderIds
        .map((id) => state.skippedDetailsById.get(id))
        .filter(Boolean);
}

function applyFavoritesIds(ids) {
    state.favoriteOrderIds = [...ids];
    state.favoriteIds = new Set(ids);
    syncFavoritesArray();
}

function applyFavoriteDetails(detailsMapLike) {
    state.favoriteDetailsById = new Map();
    Object.entries(detailsMapLike || {}).forEach(([rawId, movie]) => {
        const id = Number(rawId);
        if (!Number.isFinite(id) || !movie) return;
        state.favoriteDetailsById.set(id, movie);
    });
    syncFavoritesArray();
}

function applyLikedIds(ids) {
    state.likedOrderIds = [...ids];
    state.likedIds = new Set(ids);
    syncLikedArray();
}

function applyLikedDetails(detailsMapLike) {
    state.likedDetailsById = new Map();
    Object.entries(detailsMapLike || {}).forEach(([rawId, movie]) => {
        const id = Number(rawId);
        if (!Number.isFinite(id) || !movie) return;
        state.likedDetailsById.set(id, movie);
    });
    syncLikedArray();
}

function applyWatchedIds(ids) {
    state.watchedOrderIds = [...ids];
    state.watchedIds = new Set(ids);
    syncWatchedArray();
}

function applyWatchedDetails(detailsMapLike) {
    state.watchedDetailsById = new Map();
    Object.entries(detailsMapLike || {}).forEach(([rawId, movie]) => {
        const id = Number(rawId);
        if (!Number.isFinite(id) || !movie) return;
        state.watchedDetailsById.set(id, movie);
    });
    syncWatchedArray();
}

function applySkippedIds(ids) {
    state.skippedOrderIds = [...ids];
    state.skippedIds = new Set(ids);
    syncSkippedArray();
}

function applySkippedDetails(detailsMapLike) {
    state.skippedDetailsById = new Map();
    Object.entries(detailsMapLike || {}).forEach(([rawId, movie]) => {
        const id = Number(rawId);
        if (!Number.isFinite(id) || !movie) return;
        state.skippedDetailsById.set(id, movie);
    });
    syncSkippedArray();
}

function upsertFavoriteDetail(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.favoriteDetailsById.set(movie.id, movie);
    syncFavoritesArray();
}

function upsertLikedDetail(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.likedDetailsById.set(movie.id, movie);
    syncLikedArray();
}

function upsertWatchedDetail(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.watchedDetailsById.set(movie.id, movie);
    syncWatchedArray();
}

function upsertSkippedDetail(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.skippedDetailsById.set(movie.id, movie);
    syncSkippedArray();
}

function isMovieProcessed(movieId) {
    return state.favoriteIds.has(movieId)
        || state.likedIds.has(movieId)
        || state.watchedIds.has(movieId)
        || state.skippedIds.has(movieId)
        || state.seenMovieIds.has(movieId);
}

function applyFavoritesState() {
    syncFavoritesArray();
    syncLikedArray();
    syncWatchedArray();
    syncSkippedArray();
    computePreferences();
    updateFavBadge();
    renderFavorites();
}

function getSeenMoviesCacheKey() {
    return state.user ? `${SEEN_MOVIES_CACHE_PREFIX}${state.user.uid}` : null;
}

function loadSeenMoviesCache() {
    const key = getSeenMoviesCacheKey();
    if (!key) return new Set();
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
        console.warn('Не удалось прочитать кеш просмотренных фильмов:', err);
        return new Set();
    }
}

function saveSeenMoviesCache() {
    const key = getSeenMoviesCacheKey();
    if (!key) return;
    try {
        const values = [...state.seenMovieIds].slice(-SEEN_MOVIES_MAX);
        localStorage.setItem(key, JSON.stringify(values));
    } catch (err) {
        console.warn('Не удалось сохранить кеш просмотренных фильмов:', err);
    }
}

function markMovieAsSeen(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.seenMovieIds.add(movieId);
    saveSeenMoviesCache();
}

function filterUnseenMovies(movies) {
    return movies.filter((movie) => !isMovieProcessed(movie.id));
}

function isMovieInPersistentUserLists(movieId) {
    return state.favoriteIds.has(movieId)
        || state.likedIds.has(movieId)
        || state.watchedIds.has(movieId);
}

function filterMoviesOutsideUserLists(movies) {
    return movies.filter((movie) => !isMovieInPersistentUserLists(movie.id));
}

function normalizeTextForCompare(value) {
    return (value || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\./g, '')
        .replace(/\s+/g, ' ');
}

function normalizeSelectedCountryValue(value) {
    const raw = (value || '').toString().trim();
    if (!raw) return '';
    const normalized = normalizeTextForCompare(raw);
    if (
        normalized === 'любая страна' ||
        normalized === 'любая' ||
        normalized === 'страна' ||
        normalized === 'все' ||
        normalized === 'всё' ||
        normalized === 'all' ||
        normalized === 'any'
    ) {
        return '';
    }
    return raw;
}

function movieMatchesSelectedCountry(movie) {
    const selectedCountry = normalizeTextForCompare(normalizeSelectedCountryValue(state.selectedCountry));
    if (!selectedCountry) return true;
    const countryValues = [];
    if (Array.isArray(movie.countries)) {
        movie.countries.forEach((country) => countryValues.push(country));
    }
    if (typeof movie.countriesText === 'string' && movie.countriesText.trim()) {
        movie.countriesText.split(',').forEach((country) => countryValues.push(country.trim()));
    }
    if (countryValues.length === 0) return false;

    return countryValues.some((country) => {
        const normalized = normalizeTextForCompare(country);
        return normalized.includes(selectedCountry) || selectedCountry.includes(normalized);
    });
}

function applyCountryPreferenceFilter(movies) {
    const selectedCountry = normalizeSelectedCountryValue(state.selectedCountry);
    if (!selectedCountry) return movies;
    const matched = movies.filter((movie) => movieMatchesSelectedCountry(movie));
    return matched;
}

function getInteractionsCacheKey() {
    return state.user ? `${INTERACTIONS_CACHE_PREFIX}${state.user.uid}` : null;
}

function createEmptyInteractionsState() {
    return {
        likedMovieIds: new Set(),
        dislikedMovieIds: new Set(),
        openedCounts: new Map(),
        shownCounts: new Map(),
        recentShownIds: []
    };
}

function normalizeIdArray(value) {
    return Array.isArray(value)
        ? value.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];
}

function resolveStatusConflicts(statuses) {
    const skippedSet = new Set(normalizeIdArray(statuses?.skippedIds));
    const watchedList = normalizeIdArray(statuses?.watchedIds).filter((id) => !skippedSet.has(id));
    const watchedSet = new Set(watchedList);
    const likedList = normalizeIdArray(statuses?.likedIds).filter(
        (id) => !skippedSet.has(id) && !watchedSet.has(id)
    );
    const likedSet = new Set(likedList);
    const watchlistList = normalizeIdArray(statuses?.watchlistIds).filter(
        (id) => !skippedSet.has(id) && !likedSet.has(id) && !watchedSet.has(id)
    );
    return {
        watchlistIds: watchlistList,
        likedIds: likedList,
        watchedIds: watchedList,
        skippedIds: [...skippedSet]
    };
}

function normalizeCountMap(raw) {
    const map = new Map();
    if (!raw || typeof raw !== 'object') return map;
    Object.entries(raw).forEach(([rawId, rawCount]) => {
        const id = Number(rawId);
        const count = Number(rawCount);
        if (!Number.isFinite(id) || !Number.isFinite(count) || count <= 0) return;
        map.set(id, Math.floor(count));
    });
    return map;
}

function loadInteractionsCache() {
    const key = getInteractionsCacheKey();
    if (!key) return createEmptyInteractionsState();
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return createEmptyInteractionsState();
        const parsed = JSON.parse(raw);
        return {
            likedMovieIds: new Set(normalizeIdArray(parsed?.likedMovieIds)),
            dislikedMovieIds: new Set(normalizeIdArray(parsed?.dislikedMovieIds)),
            openedCounts: normalizeCountMap(parsed?.openedCounts),
            shownCounts: normalizeCountMap(parsed?.shownCounts),
            recentShownIds: normalizeIdArray(parsed?.recentShownIds).slice(-RECENT_SHOWN_MAX)
        };
    } catch (err) {
        console.warn('Failed to read interactions cache:', err);
        return createEmptyInteractionsState();
    }
}

function loadLikedCache() {
    const key = getLikedCacheKey();
    if (!key) return { ids: [], details: {} };
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { ids: [], details: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ids: [], details: {} };
        const ids = Array.isArray(parsed.ids)
            ? parsed.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
            : [];
        const details = parsed.details && typeof parsed.details === 'object' ? parsed.details : {};
        return { ids, details };
    } catch (err) {
        console.warn('Не удалось прочитать кеш liked:', err);
        return { ids: [], details: {} };
    }
}

function saveLikedCache() {
    const key = getLikedCacheKey();
    if (!key) return;
    try {
        const details = {};
        state.likedDetailsById.forEach((movie, id) => {
            details[id] = movie;
        });
        localStorage.setItem(key, JSON.stringify({
            ids: state.likedOrderIds,
            details
        }));
    } catch (err) {
        console.warn('Не удалось сохранить кеш liked:', err);
    }
}

function loadWatchedCache() {
    const key = getWatchedCacheKey();
    if (!key) return { ids: [], details: {} };
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { ids: [], details: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ids: [], details: {} };
        const ids = Array.isArray(parsed.ids)
            ? parsed.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
            : [];
        const details = parsed.details && typeof parsed.details === 'object' ? parsed.details : {};
        return { ids, details };
    } catch (err) {
        console.warn('Не удалось прочитать кеш watched:', err);
        return { ids: [], details: {} };
    }
}

function saveWatchedCache() {
    const key = getWatchedCacheKey();
    if (!key) return;
    try {
        const details = {};
        state.watchedDetailsById.forEach((movie, id) => {
            details[id] = movie;
        });
        localStorage.setItem(key, JSON.stringify({
            ids: state.watchedOrderIds,
            details
        }));
    } catch (err) {
        console.warn('Не удалось сохранить кеш watched:', err);
    }
}

function loadSkippedCache() {
    const key = getSkippedCacheKey();
    if (!key) return { ids: [], details: {} };
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { ids: [], details: {} };
        const parsed = JSON.parse(raw);
        // Обратная совместимость: старый формат — просто массив ID без деталей.
        if (Array.isArray(parsed)) {
            const ids = parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id));
            return { ids, details: {} };
        }
        if (!parsed || typeof parsed !== 'object') return { ids: [], details: {} };
        const ids = Array.isArray(parsed.ids)
            ? parsed.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
            : [];
        const details = parsed.details && typeof parsed.details === 'object' ? parsed.details : {};
        return { ids, details };
    } catch (err) {
        console.warn('Не удалось прочитать кеш skipped:', err);
        return { ids: [], details: {} };
    }
}

function saveSkippedCache() {
    const key = getSkippedCacheKey();
    if (!key) return;
    try {
        const details = {};
        state.skippedDetailsById.forEach((movie, id) => {
            details[id] = movie;
        });
        localStorage.setItem(key, JSON.stringify({
            ids: state.skippedOrderIds,
            details
        }));
    } catch (err) {
        console.warn('Не удалось сохранить кеш skipped:', err);
    }
}

function saveInteractionsCache() {
    const key = getInteractionsCacheKey();
    if (!key) return;
    try {
        const openedCounts = Object.fromEntries([...state.interactions.openedCounts.entries()].slice(-MAX_OPEN_COUNT_TRACK));
        const shownCounts = Object.fromEntries([...state.interactions.shownCounts.entries()].slice(-MAX_OPEN_COUNT_TRACK));
        localStorage.setItem(key, JSON.stringify({
            likedMovieIds: [...state.interactions.likedMovieIds],
            dislikedMovieIds: [...state.interactions.dislikedMovieIds],
            openedCounts,
            shownCounts,
            recentShownIds: state.interactions.recentShownIds.slice(-RECENT_SHOWN_MAX)
        }));
    } catch (err) {
        console.warn('Failed to save interactions cache:', err);
    }
}

function bumpCountInMap(map, movieId, amount = 1) {
    if (!Number.isFinite(movieId)) return;
    const current = map.get(movieId) || 0;
    map.set(movieId, current + amount);
}

function markMovieAsShown(movieId) {
    if (!Number.isFinite(movieId)) return;
    bumpCountInMap(state.interactions.shownCounts, movieId, 1);
    const recent = state.interactions.recentShownIds.filter((id) => id !== movieId);
    recent.push(movieId);
    state.interactions.recentShownIds = recent.slice(-RECENT_SHOWN_MAX);
    saveInteractionsCache();
}

function markMovieOpened(movieId) {
    if (!Number.isFinite(movieId)) return;
    bumpCountInMap(state.interactions.openedCounts, movieId, 1);
    saveInteractionsCache();
}

function markMovieLiked(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.interactions.dislikedMovieIds.delete(movieId);
    state.interactions.likedMovieIds.add(movieId);
    saveInteractionsCache();
}

function markMovieDisliked(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.interactions.likedMovieIds.delete(movieId);
    state.interactions.dislikedMovieIds.add(movieId);
    saveInteractionsCache();
}

function hasUserPreferenceSignals() {
    return state.favoriteOrderIds.length > 0
        || state.likedOrderIds.length > 0
        || state.watchedOrderIds.length > 0
        || state.skippedIds.size > 0
        || state.interactions.likedMovieIds.size > 0
        || state.interactions.dislikedMovieIds.size > 0
        || state.interactions.openedCounts.size > 0;
}

function filterRecentlyShownMovies(movies) {
    const recentSet = new Set(state.interactions.recentShownIds.slice(-RECENT_SHOWN_PENALTY_WINDOW));
    if (recentSet.size === 0) return movies;
    const filtered = movies.filter((movie) => !recentSet.has(movie.id));
    if (filtered.length >= Math.min(12, Math.ceil(movies.length * 0.4))) return filtered;
    return movies;
}

// ============================================================
// DOM-элементы
// ============================================================
const $ = (id) => document.getElementById(id);

// Auth elements
const screenAuth = $('screen-auth');
const formLogin = $('form-login');
const formRegister = $('form-register');
const loginError = $('login-error');
const registerError = $('register-error');
const mainApp = $('main-app');

// App elements
const cardStack = $('card-stack');
const loader = $('loader');
const swipeActions = $('swipe-actions');
const emptyState = $('empty-state');
const errorState = $('error-state');
const errorMessage = $('error-message');
const favBadge = $('fav-badge');
const watchlistGrid = $('watchlist-grid');
const likedGrid = $('liked-grid');
const watchedGrid = $('watched-grid');
const skippedGrid = $('skipped-grid');
const watchlistSection = $('watchlist-section');
const likedSection = $('liked-section');
const watchedSection = $('watched-section');
const skippedSection = $('skipped-section');
const favLoader = $('fav-loader');
const emptyFavs = $('empty-favorites');
const searchOverlay = $('search-overlay');
const searchInput = $('search-input');
const searchResults = $('search-results');
const searchHint = $('search-hint');
const searchLoader = $('search-loader');
const searchEmpty = $('search-empty');
const searchClearBtn = $('btn-search-clear');
const aiOverlay = $('ai-overlay');
const aiMessages = $('ai-messages');
const aiInput = $('ai-input');
const aiSendBtn = $('btn-ai-send');
const popupOverlay = $('popup-overlay');
const popupPoster = $('popup-poster');
const popupTitle = $('popup-title');
const popupYear = $('popup-year');
const popupRating = $('popup-rating');
const popupCountry = $('popup-country');
const popupGenre = $('popup-genre');
const popupDuration = $('popup-duration');
const popupDesc = $('popup-description');
const popupToggleWatchlist = $('popup-toggle-watchlist');
const popupToggleWatchlistText = $('popup-toggle-watchlist-text');
const popupToggleWatched = $('popup-toggle-watched');
const popupToggleWatchedText = $('popup-toggle-watched-text');
const popupTrailerBtn = $('popup-trailer');
const popupWatchBtn = $('popup-watch');
const trailerOverlay = $('trailer-overlay');
const trailerFrame = $('trailer-frame');
const trailerClose = $('trailer-close');
const userMenu = $('user-menu');
const userName = $('user-name');
const userEmail = $('user-email');
const userAvatar = $('user-avatar');
const settingsOverlay = $('settings-overlay');
const settingsUserName = $('settings-user-name');
const settingsUserEmail = $('settings-user-email');
const settingsUserAvatar = $('settings-user-avatar');
const aboutModalOverlay = $('about-modal-overlay');
const aboutAppName = $('about-app-name');
const aboutAppDescription = $('about-app-description');
const aboutVersion = $('about-version');
const confirmModalOverlay = $('confirm-modal-overlay');
const confirmModalTitle = $('confirm-modal-title');
const confirmModalMessage = $('confirm-modal-message');
const confirmModalCancel = $('btn-confirm-cancel');
const confirmModalOk = $('btn-confirm-ok');
const moodFilters = $('mood-filters');
const countryPickerOverlay = $('country-picker-overlay');
const countryPickerList = $('country-picker-list');
const countryPickerClose = $('country-picker-close');
const appAnnouncement = $('app-announcement');
const appAnnouncementTitle = $('app-announcement-title');
const appAnnouncementText = $('app-announcement-text');
const appAnnouncementAction = $('app-announcement-action');
const appAnnouncementClose = $('app-announcement-close');

// ============================================================
// FIREBASE AUTH — Регистрация и Вход
// ============================================================

/**
 * Регистрация нового пользователя (Email + Password)
 */
async function handleRegister(e) {
    e.preventDefault();
    const name = $('register-name').value.trim();
    const email = $('register-email').value.trim();
    const password = $('register-password').value;

    registerError.textContent = '';
    setAuthLoading('btn-register', true);

    try {
        // Создаём пользователя в Firebase Auth
        const cred = await createUserWithEmailAndPassword(auth, email, password);

        // Обновляем профиль — сохраняем имя
        await updateProfile(cred.user, { displayName: name });
        saveProfileNameCache(name, cred.user.uid);

        console.log('✅ Регистрация успешна:', cred.user.email);
        // onAuthStateChanged автоматически переключит на основной экран
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        registerError.textContent = formatAuthError(err);
    } finally {
        setAuthLoading('btn-register', false);
    }
}

/**
 * Вход существующего пользователя (Email + Password)
 */
async function handleLogin(e) {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;

    loginError.textContent = '';
    setAuthLoading('btn-login', true);

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log('✅ Вход успешен:', cred.user.email);
        // onAuthStateChanged автоматически переключит на основной экран
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        loginError.textContent = formatAuthError(err);
    } finally {
        setAuthLoading('btn-login', false);
    }
}

/**
 * Выход из аккаунта
 */
async function handleLogout() {
    try {
        await signOut(auth);
        console.log('✅ Выход из аккаунта');
        showAuthScreen();
        loginError.textContent = '';
        registerError.textContent = '';
    } catch (err) {
        console.error('❌ Ошибка выхода:', err);
        showAuthScreen();
        loginError.textContent = `\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u044b\u0439\u0442\u0438 \u0438\u0437 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 (${err?.code || 'auth/logout-failed'})`;
    }
}

/**
 * Переключение loading-состояния кнопки
 */
function setAuthLoading(btnId, isLoading) {
    const btn = $(btnId);
    btn.disabled = isLoading;
    btn.querySelector('.btn-text').style.display = isLoading ? 'none' : '';
    btn.querySelector('.btn-loader').style.display = isLoading ? 'inline-block' : 'none';
}

/**
 * Наблюдатель за состоянием авторизации.
 * Вызывается автоматически при входе/выходе.
 */
function setupAuthObserver() {
    let isInitialAuthResolved = false;
    onAuthStateChanged(auth, (user) => {
        if (!isInitialAuthResolved) {
            isInitialAuthResolved = true;
            document.body.classList.remove('app-booting');
        }
        if (user) {
            // ✅ Пользователь вошёл
            const isNewUserSession = state.user?.uid !== user.uid;
            state.user = user;
            showMainApp(user, isNewUserSession);
        } else {
            // ❌ Пользователь вышел
            state.user = null;
            showAuthScreen();
        }
    });
}

/**
 * Показать главное приложение после входа
 */
function showMainApp(user, forceReload = false) {
    screenAuth.classList.remove('active');
    screenAuth.style.display = 'none';
    mainApp.style.display = 'flex';

    // Обновляем UI профиля
    syncProfileInfoToSettings();
    if (aboutVersion) {
        aboutVersion.textContent = resolveAppVersion();
    }
    if (aboutAppName) {
        aboutAppName.textContent = APP_RUNTIME_CONFIG.appName;
    }
    if (aboutAppDescription) {
        aboutAppDescription.textContent = APP_RUNTIME_CONFIG.appDescription;
    }
    state.seenMovieIds = loadSeenMoviesCache();
    state.interactions = loadInteractionsCache();
    const watchlistCache = loadFavoritesCache();
    const likedCache = loadLikedCache();
    const watchedCache = loadWatchedCache();
    const skippedCache = loadSkippedCache();
    const resolvedStatuses = resolveStatusConflicts({
        watchlistIds: watchlistCache.ids,
        likedIds: likedCache.ids,
        watchedIds: watchedCache.ids,
        skippedIds: skippedCache.ids
    });
    applyFavoritesIds(resolvedStatuses.watchlistIds);
    applyFavoriteDetails(watchlistCache.details);
    state.favoritesVisibleCount = FAVORITES_PAGE_SIZE;
    applyLikedIds(resolvedStatuses.likedIds);
    applyLikedDetails(likedCache.details);
    state.likedVisibleCount = FAVORITES_PAGE_SIZE;
    applyWatchedIds(resolvedStatuses.watchedIds);
    applyWatchedDetails(watchedCache.details);
    state.watchedVisibleCount = FAVORITES_PAGE_SIZE;
    applySkippedIds(resolvedStatuses.skippedIds);
    applySkippedDetails(skippedCache.details);
    state.skippedVisibleCount = FAVORITES_PAGE_SIZE;
    applyFavoritesState();

    const shouldLoadDiscover = forceReload || state.movies.length === 0;
    let restoredFromCache = false;
    if (shouldLoadDiscover) {
        restoredFromCache = restoreDiscoverFeedFromCache();
        if (!restoredFromCache) {
            loadMovies();
        }
    }

    const cloudSyncPromise = syncStatusesFromCloud({ bootstrapLocalToCloudWhenEmpty: true });
    void cloudSyncPromise
        .then(() => {
            if (state.movies.length > 0) {
                const filteredMovies = filterUnseenMovies(state.movies);
                if (filteredMovies.length !== state.movies.length) {
                    state.movies = filteredMovies;
                    state.currentIndex = 0;
                    state.lastShownMovieId = null;
                    if (state.movies.length > 0) {
                        saveDiscoverFeedCache();
                        renderCards();
                    } else if (!state.isLoading) {
                        loadMovies();
                    }
                }
            } else if (!state.isLoading && !restoredFromCache) {
                loadMovies();
            }
        })
        .catch((err) => {
            console.error('Cloud status sync failed during login:', err);
        });
}

/**
 * Показать экран авторизации
 */
function showAuthScreen() {
    mainApp.style.display = 'none';
    screenAuth.style.display = 'flex';
    screenAuth.classList.add('active');
    userMenu.classList.remove('active');
    closeSettingsOverlay();
    document.body.style.overflow = '';

    // Очищаем состояние
    state.favorites = [];
    state.favoriteIds.clear();
    state.favoriteOrderIds = [];
    state.favoriteDetailsById.clear();
    state.favoriteDetailsInFlight.clear();
    state.favoritesVisibleCount = FAVORITES_PAGE_SIZE;
    state.likedMovies = [];
    state.likedIds.clear();
    state.likedOrderIds = [];
    state.likedDetailsById.clear();
    state.likedDetailsInFlight.clear();
    state.likedVisibleCount = FAVORITES_PAGE_SIZE;
    state.watchedMovies = [];
    state.watchedIds.clear();
    state.watchedOrderIds = [];
    state.watchedDetailsById.clear();
    state.watchedDetailsInFlight.clear();
    state.watchedVisibleCount = FAVORITES_PAGE_SIZE;
    state.skippedIds.clear();
    state.skippedMovies = [];
    state.skippedOrderIds = [];
    state.skippedDetailsById.clear();
    state.skippedDetailsInFlight.clear();
    state.skippedVisibleCount = FAVORITES_PAGE_SIZE;
    state.preferences = {
        categoryWeights: {},
        typeWeights: {},
        countryWeights: {},
        keywordWeights: {},
        preferredYear: null,
        preferredRating: null
    };
    state.selectedCategoryIds.clear();
    state.selectedCountry = '';
    state.seenMovieIds = new Set();
    state.interactions = createEmptyInteractionsState();
    state.lastShownMovieId = null;
    state.movies = [];
    state.currentIndex = 0;
    state.page = 1;
    state.isPrefetching = false;
    state.currentTab = 'discover';
    cardStack.innerHTML = '';
    if (watchlistGrid) watchlistGrid.innerHTML = '';
    if (likedGrid) likedGrid.innerHTML = '';
    if (watchedGrid) watchedGrid.innerHTML = '';
    if (skippedGrid) skippedGrid.innerHTML = '';
    renderCategoryFilters();
    updateFavBadge();
}

// ============================================================
// FIRESTORE — Избранное в облаке
// ============================================================

/**
 * Путь к документу пользователя:
 * users/{user_id}/favorites/{film_id}
 */
function getUserDocRef() {
    return doc(db, 'users', state.user.uid);
}

function toMovieFromDetails(id, details) {
    const normalized = normalizeMovie({
        ...details,
        kinopoiskId: id
    });
    if (!Number.isFinite(normalized.id)) {
        normalized.id = Number(id);
        normalized.kinopoiskId = Number(id);
    }
    if (!normalized.title) {
        normalized.title = `Film #${id}`;
    }
    return normalized;
}

async function readMovieStatusesFromCloud() {
    const snapshot = await getDoc(getUserDocRef());
    if (!snapshot.exists()) {
        return { watchlistIds: [], likedIds: [], watchedIds: [], skippedIds: [] };
    }
    const data = snapshot.data() || {};
    const watchlistLegacy = normalizeIdArray(data.favorites);
    return resolveStatusConflicts({
        watchlistIds: [...new Set([...watchlistLegacy, ...normalizeIdArray(data.watchlist)])],
        likedIds: [...new Set(normalizeIdArray(data.liked))],
        watchedIds: [...new Set(normalizeIdArray(data.watched))],
        skippedIds: [...new Set([...normalizeIdArray(data.skipped), ...normalizeIdArray(data.disliked)])]
    });
}

async function fetchMovieDetailsBatch(ids) {
    const detailsList = await Promise.all(ids.map(async (id) => {
        const details = await fetchMovieDetails(id);
        if (!details) return null;
        return toMovieFromDetails(id, details);
    }));
    return detailsList.filter(Boolean);
}

async function ensureDetailsForVisible(visibleIds, detailsById, detailsInFlight, upsertFn, saveCacheFn) {
    const missingIds = visibleIds.filter(
        (id) => !detailsById.has(id) && !detailsInFlight.has(id)
    );

    if (missingIds.length === 0) return;

    missingIds.forEach((id) => detailsInFlight.add(id));
    try {
        const movies = await fetchMovieDetailsBatch(missingIds);
        movies.forEach((movie) => upsertFn(movie));
        applyFavoritesState();
        saveCacheFn();
    } finally {
        missingIds.forEach((id) => detailsInFlight.delete(id));
    }
}

async function ensureFavoriteDetailsForVisible() {
    const visibleIds = state.favoriteOrderIds.slice(0, state.favoritesVisibleCount);
    await ensureDetailsForVisible(
        visibleIds,
        state.favoriteDetailsById,
        state.favoriteDetailsInFlight,
        upsertFavoriteDetail,
        saveFavoritesCache
    );
}

async function ensureLikedDetailsForVisible() {
    const visibleIds = state.likedOrderIds.slice(0, state.likedVisibleCount);
    await ensureDetailsForVisible(
        visibleIds,
        state.likedDetailsById,
        state.likedDetailsInFlight,
        upsertLikedDetail,
        saveLikedCache
    );
}

async function ensureWatchedDetailsForVisible() {
    const visibleIds = state.watchedOrderIds.slice(0, state.watchedVisibleCount);
    await ensureDetailsForVisible(
        visibleIds,
        state.watchedDetailsById,
        state.watchedDetailsInFlight,
        upsertWatchedDetail,
        saveWatchedCache
    );
}

async function ensureSkippedDetailsForVisible() {
    const visibleIds = state.skippedOrderIds.slice(0, state.skippedVisibleCount);
    await ensureDetailsForVisible(
        visibleIds,
        state.skippedDetailsById,
        state.skippedDetailsInFlight,
        upsertSkippedDetail,
        saveSkippedCache
    );
}

function renderListSkeleton(grid, count = FAVORITES_PAGE_SIZE) {
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const card = document.createElement('div');
        card.className = 'fav-card skeleton';
        card.innerHTML = `
            <div class="skeleton-poster"></div>
            <div class="fav-info">
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
            </div>
        `;
        grid.appendChild(card);
    }
}

function renderFavoritesSkeleton(count = 4) {
    emptyFavs.style.display = 'none';
    if (watchlistSection) watchlistSection.style.display = '';
    if (likedSection) likedSection.style.display = '';
    if (watchedSection) watchedSection.style.display = '';
    if (skippedSection) skippedSection.style.display = state.skippedOrderIds.length > 0 ? '' : 'none';
    renderListSkeleton(watchlistGrid, count);
    renderListSkeleton(likedGrid, count);
    renderListSkeleton(watchedGrid, count);
    if (state.skippedOrderIds.length > 0) {
        renderListSkeleton(skippedGrid, count);
    }
}

function removeFromWatchlistLocal(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.favoriteIds.delete(movieId);
    state.favoriteOrderIds = state.favoriteOrderIds.filter((id) => id !== movieId);
    state.favoriteDetailsById.delete(movieId);
    syncFavoritesArray();
}

function removeFromLikedLocal(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.likedIds.delete(movieId);
    state.likedOrderIds = state.likedOrderIds.filter((id) => id !== movieId);
    state.likedDetailsById.delete(movieId);
    state.interactions.likedMovieIds.delete(movieId);
    syncLikedArray();
}

function removeFromWatchedLocal(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.watchedIds.delete(movieId);
    state.watchedOrderIds = state.watchedOrderIds.filter((id) => id !== movieId);
    state.watchedDetailsById.delete(movieId);
    syncWatchedArray();
}

function removeFromSkippedLocal(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.skippedIds.delete(movieId);
    state.skippedOrderIds = state.skippedOrderIds.filter((id) => id !== movieId);
    state.skippedDetailsById.delete(movieId);
    state.interactions.dislikedMovieIds.delete(movieId);
    syncSkippedArray();
}

function removeMovieFromAllLocalStatuses(movieId) {
    removeFromWatchlistLocal(movieId);
    removeFromLikedLocal(movieId);
    removeFromWatchedLocal(movieId);
    removeFromSkippedLocal(movieId);
}

function addToWatchlistLocal(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.favoriteIds.add(movie.id);
    state.favoriteOrderIds = [movie.id, ...state.favoriteOrderIds.filter((id) => id !== movie.id)];
    upsertFavoriteDetail(movie);
    state.favoritesVisibleCount = Math.max(state.favoritesVisibleCount, FAVORITES_PAGE_SIZE);
    state.interactions.likedMovieIds.delete(movie.id);
    state.interactions.dislikedMovieIds.delete(movie.id);
}

function addToLikedLocal(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.likedIds.add(movie.id);
    state.likedOrderIds = [movie.id, ...state.likedOrderIds.filter((id) => id !== movie.id)];
    upsertLikedDetail(movie);
    state.likedVisibleCount = Math.max(state.likedVisibleCount, FAVORITES_PAGE_SIZE);
    markMovieLiked(movie.id);
}

function addToWatchedLocal(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.watchedIds.add(movie.id);
    state.watchedOrderIds = [movie.id, ...state.watchedOrderIds.filter((id) => id !== movie.id)];
    upsertWatchedDetail(movie);
    state.watchedVisibleCount = Math.max(state.watchedVisibleCount, FAVORITES_PAGE_SIZE);
    state.interactions.likedMovieIds.delete(movie.id);
    state.interactions.dislikedMovieIds.delete(movie.id);
}

function addToSkippedLocal(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.skippedIds.add(movie.id);
    state.skippedOrderIds = [movie.id, ...state.skippedOrderIds.filter((id) => id !== movie.id)];
    upsertSkippedDetail(movie);
    state.skippedVisibleCount = Math.max(state.skippedVisibleCount, FAVORITES_PAGE_SIZE);
    markMovieDisliked(movie.id);
}

function saveAllStatusCaches() {
    saveFavoritesCache();
    saveLikedCache();
    saveWatchedCache();
    saveSkippedCache();
    saveInteractionsCache();
}

let statusCloudSyncInFlight = null;
let statusCloudSyncUid = null;

function hasAnyStatuses(statuses) {
    if (!statuses || typeof statuses !== 'object') return false;
    return (Array.isArray(statuses.watchlistIds) && statuses.watchlistIds.length > 0)
        || (Array.isArray(statuses.likedIds) && statuses.likedIds.length > 0)
        || (Array.isArray(statuses.watchedIds) && statuses.watchedIds.length > 0)
        || (Array.isArray(statuses.skippedIds) && statuses.skippedIds.length > 0);
}

function getCurrentStatusSnapshot() {
    return resolveStatusConflicts({
        watchlistIds: [...state.favoriteOrderIds],
        likedIds: [...state.likedOrderIds],
        watchedIds: [...state.watchedOrderIds],
        skippedIds: [...state.skippedOrderIds]
    });
}

function applyCloudStatusesToLocalState(statuses) {
    const resolved = resolveStatusConflicts(statuses);
    applyFavoritesIds(resolved.watchlistIds);
    applyLikedIds(resolved.likedIds);
    applyWatchedIds(resolved.watchedIds);
    applySkippedIds(resolved.skippedIds);

    const watchlistPruned = new Map();
    resolved.watchlistIds.forEach((id) => {
        const movie = state.favoriteDetailsById.get(id);
        if (movie) watchlistPruned.set(id, movie);
    });
    state.favoriteDetailsById = watchlistPruned;
    syncFavoritesArray();

    const likedPruned = new Map();
    resolved.likedIds.forEach((id) => {
        const movie = state.likedDetailsById.get(id);
        if (movie) likedPruned.set(id, movie);
    });
    state.likedDetailsById = likedPruned;
    syncLikedArray();

    const watchedPruned = new Map();
    resolved.watchedIds.forEach((id) => {
        const movie = state.watchedDetailsById.get(id);
        if (movie) watchedPruned.set(id, movie);
    });
    state.watchedDetailsById = watchedPruned;
    syncWatchedArray();

    const skippedPruned = new Map();
    resolved.skippedIds.forEach((id) => {
        const movie = state.skippedDetailsById.get(id);
        if (movie) skippedPruned.set(id, movie);
    });
    state.skippedDetailsById = skippedPruned;
    syncSkippedArray();
}

async function pushStatusesSnapshotToCloud(statuses) {
    if (!state.user) return;
    const resolved = resolveStatusConflicts(statuses);
    const payload = {
        watchlist: resolved.watchlistIds,
        favorites: resolved.watchlistIds,
        liked: resolved.likedIds,
        watched: resolved.watchedIds,
        skipped: resolved.skippedIds,
        disliked: resolved.skippedIds
    };
    await setDoc(getUserDocRef(), payload, { merge: true });
}

async function syncStatusesFromCloud(options = {}) {
    const {
        bootstrapLocalToCloudWhenEmpty = true
    } = options;

    if (!state.user) return { source: 'no-user' };
    const uid = state.user.uid;

    if (statusCloudSyncInFlight && statusCloudSyncUid === uid) {
        return statusCloudSyncInFlight;
    }

    statusCloudSyncUid = uid;
    statusCloudSyncInFlight = (async () => {
        const localSnapshot = getCurrentStatusSnapshot();
        const cloudStatuses = await Promise.race([
            readMovieStatusesFromCloud(),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Firestore timeout')), FIRESTORE_TIMEOUT_MS);
            })
        ]);

        if (!state.user || state.user.uid !== uid) {
            return { source: 'stale-session' };
        }

        const resolvedCloudStatuses = resolveStatusConflicts(cloudStatuses);
        const cloudHasData = hasAnyStatuses(resolvedCloudStatuses);
        const localHasData = hasAnyStatuses(localSnapshot);

        if (cloudHasData) {
            applyCloudStatusesToLocalState(resolvedCloudStatuses);
            saveAllStatusCaches();
            applyFavoritesState();
            return { source: 'cloud' };
        }

        if (bootstrapLocalToCloudWhenEmpty && localHasData) {
            await pushStatusesSnapshotToCloud(localSnapshot);
            saveAllStatusCaches();
            applyFavoritesState();
            return { source: 'local-bootstrapped' };
        }

        applyCloudStatusesToLocalState(resolvedCloudStatuses);
        saveAllStatusCaches();
        applyFavoritesState();
        return { source: 'empty' };
    })();

    try {
        return await statusCloudSyncInFlight;
    } finally {
        if (statusCloudSyncUid === uid) {
            statusCloudSyncInFlight = null;
            statusCloudSyncUid = null;
        }
    }
}

async function syncStatusToFirestore(movieId, status) {
    if (!state.user) return;
    if (!Number.isFinite(movieId)) return;
    const payload = {
        watchlist: status === 'watchlist' ? arrayUnion(movieId) : arrayRemove(movieId),
        favorites: status === 'watchlist' ? arrayUnion(movieId) : arrayRemove(movieId),
        liked: status === 'liked' ? arrayUnion(movieId) : arrayRemove(movieId),
        watched: status === 'watched' ? arrayUnion(movieId) : arrayRemove(movieId),
        skipped: status === 'skipped' ? arrayUnion(movieId) : arrayRemove(movieId),
        disliked: status === 'skipped' ? arrayUnion(movieId) : arrayRemove(movieId)
    };
    try {
        await setDoc(getUserDocRef(), payload, { merge: true });
    } catch (err) {
        console.error('Firestore write failed:', err);
    }
}

async function removeStatusFromFirestore(movieId, status) {
    if (!state.user) return;
    if (!Number.isFinite(movieId)) return;
    let payload = {};
    if (status === 'watchlist') {
        payload = { watchlist: arrayRemove(movieId), favorites: arrayRemove(movieId) };
    } else if (status === 'liked') {
        payload = { liked: arrayRemove(movieId) };
    } else if (status === 'watched') {
        payload = { watched: arrayRemove(movieId) };
    } else if (status === 'skipped') {
        payload = { skipped: arrayRemove(movieId), disliked: arrayRemove(movieId) };
    } else {
        return;
    }
    try {
        await setDoc(getUserDocRef(), payload, { merge: true });
    } catch (err) {
        console.error('Firestore delete failed:', err);
    }
}

function setMovieStatusLocally(movie, status) {
    if (!movie || !Number.isFinite(movie.id)) return;
    removeMovieFromAllLocalStatuses(movie.id);
    if (status === 'watchlist') {
        addToWatchlistLocal(movie);
    } else if (status === 'liked') {
        addToLikedLocal(movie);
    } else if (status === 'watched') {
        addToWatchedLocal(movie);
    } else if (status === 'skipped') {
        addToSkippedLocal(movie);
    }
    markMovieAsSeen(movie.id);
    saveAllStatusCaches();
    applyFavoritesState();
}

function removeMovieFromStatusLocally(movieId, status) {
    const normalizedId = Number(movieId);
    if (!Number.isFinite(normalizedId)) return;
    if (status === 'watchlist') {
        removeFromWatchlistLocal(normalizedId);
    } else if (status === 'liked') {
        removeFromLikedLocal(normalizedId);
    } else if (status === 'watched') {
        removeFromWatchedLocal(normalizedId);
    } else if (status === 'skipped') {
        removeFromSkippedLocal(normalizedId);
    }
    saveAllStatusCaches();
    applyFavoritesState();
}

async function loadFavoritesFromFirestore() {
    if (!state.user) return;

    const watchlistCache = loadFavoritesCache();
    const likedCache = loadLikedCache();
    const watchedCache = loadWatchedCache();
    const skippedCache = loadSkippedCache();
    const resolvedCacheStatuses = resolveStatusConflicts({
        watchlistIds: watchlistCache.ids,
        likedIds: likedCache.ids,
        watchedIds: watchedCache.ids,
        skippedIds: skippedCache.ids
    });
    applyFavoritesIds(resolvedCacheStatuses.watchlistIds);
    applyFavoriteDetails(watchlistCache.details);
    state.favoritesVisibleCount = FAVORITES_PAGE_SIZE;
    applyLikedIds(resolvedCacheStatuses.likedIds);
    applyLikedDetails(likedCache.details);
    state.likedVisibleCount = FAVORITES_PAGE_SIZE;
    applyWatchedIds(resolvedCacheStatuses.watchedIds);
    applyWatchedDetails(watchedCache.details);
    state.watchedVisibleCount = FAVORITES_PAGE_SIZE;
    applySkippedIds(resolvedCacheStatuses.skippedIds);
    applySkippedDetails(skippedCache.details);
    state.skippedVisibleCount = FAVORITES_PAGE_SIZE;
    favLoader.style.display = 'none';

    const hasLocalStatuses = state.favoriteOrderIds.length > 0 || state.likedOrderIds.length > 0 || state.watchedOrderIds.length > 0;
    if (hasLocalStatuses) {
        applyFavoritesState();
        ensureFavoriteDetailsForVisible();
        ensureLikedDetailsForVisible();
        ensureWatchedDetailsForVisible();
    } else {
        renderFavoritesSkeleton();
    }

    try {
        await syncStatusesFromCloud({ bootstrapLocalToCloudWhenEmpty: true });

        if (state.favoriteOrderIds.length === 0 &&
            state.likedOrderIds.length === 0 &&
            state.watchedOrderIds.length === 0) {
            renderFavorites();
            return;
        }

        applyFavoritesState();
        ensureFavoriteDetailsForVisible();
        ensureLikedDetailsForVisible();
        ensureWatchedDetailsForVisible();
    } catch (err) {
        console.error('Firestore favorites load failed:', err);
        if (state.favoriteOrderIds.length === 0 &&
            state.likedOrderIds.length === 0 &&
            state.watchedOrderIds.length === 0) {
            renderFavorites();
        }
    }
}
function normalizeGenres(source) {
    if (Array.isArray(source)) {
        return source.map((genre) => (genre.genre || '').toString()).filter(Boolean);
    }
    if (typeof source === 'string') {
        return source.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function normalizeCountries(source) {
    if (Array.isArray(source)) {
        return source.map((country) => (country.country || country.name || '').toString()).filter(Boolean);
    }
    if (typeof source === 'string') {
        return source.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function parseRatingValue(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const normalized = String(rawValue).trim().replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatRatingValue(rating) {
    if (!Number.isFinite(rating)) return '';
    const rounded = Math.round(rating * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildRatingLabel(ratingKinopoisk, ratingImdb) {
    const parts = [];
    if (Number.isFinite(ratingKinopoisk)) {
        parts.push(`KP ${formatRatingValue(ratingKinopoisk)}`);
    }
    if (Number.isFinite(ratingImdb)) {
        parts.push(`IMDb ${formatRatingValue(ratingImdb)}`);
    }
    return parts.join(' • ');
}

function normalizeAgeLimits(rawValue) {
    if (!rawValue && rawValue !== 0) return '';
    const digits = String(rawValue).match(/\d+/);
    if (!digits) return '';
    return `${digits[0]}+`;
}

function getMovieRatingText(movie) {
    if (!movie) return '';
    if (typeof movie.ratingLabel === 'string' && movie.ratingLabel.trim()) {
        return movie.ratingLabel.trim();
    }
    const rating = parseRatingValue(movie.rating);
    return Number.isFinite(rating) ? `KP ${formatRatingValue(rating)}` : '';
}

function getMovieMetaText(movie) {
    if (!movie) return '';
    const genres = movie.genresText || (Array.isArray(movie.genres) ? movie.genres.join(', ') : '');
    const metaParts = [genres, movie.ratingAgeLimits || ''].filter(Boolean);
    return metaParts.join(' • ');
}

function countryNameToIsoCode(countryName) {
    const normalized = (countryName || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\./g, '');
    return COUNTRY_CODE_BY_NAME[normalized] || null;
}

function isoToFlagEmoji(isoCode) {
    if (!isoCode || isoCode.length !== 2) return '';
    const upper = isoCode.toUpperCase();
    const a = upper.charCodeAt(0);
    const b = upper.charCodeAt(1);
    if (a < 65 || a > 90 || b < 65 || b > 90) return '';
    return String.fromCodePoint(127397 + a, 127397 + b);
}

function getPrimaryCountryName(movie) {
    if (Array.isArray(movie.countries) && movie.countries.length > 0) {
        return movie.countries[0];
    }
    if (typeof movie.countriesText === 'string' && movie.countriesText.trim()) {
        return movie.countriesText.split(',')[0].trim();
    }
    return '';
}

function formatCountryWithFlag(movie) {
    const country = getPrimaryCountryName(movie);
    if (!country) return '';
    const iso = countryNameToIsoCode(country);
    const flag = isoToFlagEmoji(iso);
    return flag ? `${flag} ${country}` : country;
}

function setPopupMetaChip(node, value) {
    if (!node) return;
    const safe = (value || '').toString().trim();
    node.textContent = safe;
    node.style.display = safe ? '' : 'none';
}

// Продолжительность фильма. Kinopoisk отдаёт её либо числом минут (каталог),
// либо строкой «Ч:ММ» (поиск по ключевому слову) — поддерживаем оба формата.
function formatMovieDuration(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return `${Math.round(value)} мин`;
    }
    const raw = value.toString().trim();
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
        return `${Math.round(asNumber)} мин`;
    }
    const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
        const minutes = parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
        if (minutes > 0) return `${minutes} мин`;
    }
    return '';
}

function inferContentType(rawType, genres) {
    const type = (rawType || '').toString().toUpperCase();
    const joinedGenres = genres.join(' ').toLowerCase();
    if (type.includes('TV') || joinedGenres.includes('\u0441\u0435\u0440\u0438\u0430\u043b')) return 'TV_SERIES';
    if (joinedGenres.includes('\u043c\u0443\u043b\u044c\u0442') || joinedGenres.includes('\u0430\u043d\u0438\u043c\u0430\u0446')) return 'CARTOON';
    return 'FILM';
}

function inferMovieCategoryIds(movie) {
    const haystack = `${movie.genres.join(' ')} ${movie.title || ''} ${movie.description || ''}`.toLowerCase();
    const matched = [];
    state.allCategories.forEach((category) => {
        if (category.id === 'all') return;
        if (category.contentType === 'TV_SERIES' && movie.contentType === 'TV_SERIES') {
            matched.push(category.id);
            return;
        }
        if (category.contentType === 'CARTOON' && movie.contentType === 'CARTOON') {
            matched.push(category.id);
            return;
        }
        if (category.keywords.some((keyword) => haystack.includes(keyword))) {
            matched.push(category.id);
        }
    });
    return [...new Set(matched)];
}

function normalizeMovie(film) {
    const genres = normalizeGenres(film.genres || []);
    const countries = normalizeCountries(film.countries || []);
    const contentType = inferContentType(film.type, genres);
    const kinopoiskId = Number(film.kinopoiskId || film.filmId || film.id);
    const normalizedKinopoiskId = Number.isFinite(kinopoiskId) ? kinopoiskId : null;
    const ratingKinopoisk = parseRatingValue(film.ratingKinopoisk || film.rating);
    const ratingImdb = parseRatingValue(film.ratingImdb);
    const ratingLabel = buildRatingLabel(ratingKinopoisk, ratingImdb);
    const title = film.nameRu || film.nameEn || film.nameOriginal || film.title || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f';
    const posterUrl = film.posterUrl || film.posterFull || film.posterUrlPreview || film.poster || '';
    const posterUrlPreview = film.posterUrlPreview || film.posterUrl || film.poster || '';
    const normalized = {
        id: normalizedKinopoiskId,
        kinopoiskId: normalizedKinopoiskId,
        nameRu: film.nameRu || '',
        nameEn: film.nameEn || '',
        nameOriginal: film.nameOriginal || '',
        title,
        posterUrl,
        posterUrlPreview,
        poster: posterUrlPreview,
        posterFull: posterUrl,
        ratingKinopoisk,
        ratingImdb,
        ratingAgeLimits: normalizeAgeLimits(film.ratingAgeLimits),
        ratingLabel,
        rating: ratingKinopoisk ?? ratingImdb,
        year: film.year || '',
        filmLength: film.filmLength ?? film.filmLengthMinutes ?? null,
        description: film.description || film.shortDescription || '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442',
        genres,
        genresText: genres.join(', '),
        countries,
        countriesText: countries.join(', '),
        type: film.type || contentType,
        contentType,
        // Поля для определения онлайн-доступности (кнопка «Смотреть»).
        productionStatus: film.productionStatus || '',
        completed: typeof film.completed === 'boolean' ? film.completed : undefined,
        isTicketsAvailable: film.isTicketsAvailable === true,
        kinopoiskHDId: film.kinopoiskHDId || null
    };
    normalized.categoryIds = inferMovieCategoryIds(normalized);
    return normalized;
}

function getSelectedCategories() {
    return [...state.selectedCategoryIds].map((id) => CATEGORY_BY_ID.get(id)).filter(Boolean);
}

function tokenizeText(text) {
    return (text || '')
        .toString()
        .toLowerCase()
        .match(/[a-zа-яё0-9]{4,}/gi) || [];
}

function collectMovieTokens(movie) {
    const genres = Array.isArray(movie.genres) ? movie.genres.join(' ') : (movie.genres || '');
    return tokenizeText(`${movie.title || ''} ${movie.description || ''} ${genres}`);
}

function computePreferences() {
    const categoryScores = {};
    const typeScores = {};
    const countryScores = {};
    const keywordScores = {};
    const yearValues = [];
    const ratingValues = [];

    const positives = [
        ...state.favorites,
        ...state.likedMovies,
        ...state.movies.filter((movie) => state.interactions.likedMovieIds.has(movie.id))
    ];
    const uniquePositives = new Map();
    positives.forEach((movie) => {
        if (!movie || !Number.isFinite(movie.id)) return;
        if (!uniquePositives.has(movie.id)) uniquePositives.set(movie.id, movie);
    });

    uniquePositives.forEach((movie) => {
        const normalizedMovie = normalizeMovie(movie);
        normalizedMovie.categoryIds.forEach((categoryId) => {
            categoryScores[categoryId] = (categoryScores[categoryId] || 0) + 1;
        });
        typeScores[normalizedMovie.contentType] = (typeScores[normalizedMovie.contentType] || 0) + 1;
        normalizedMovie.countries.forEach((country) => {
            const key = country.toLowerCase();
            countryScores[key] = (countryScores[key] || 0) + 1;
        });
        collectMovieTokens(normalizedMovie).forEach((token) => {
            keywordScores[token] = (keywordScores[token] || 0) + 1;
        });

        const year = Number(normalizedMovie.year);
        if (Number.isFinite(year) && year > 1900 && year < 2100) yearValues.push(year);
        const rating = Number(normalizedMovie.rating);
        if (Number.isFinite(rating) && rating > 0) ratingValues.push(rating);
    });

    const categoryMax = Math.max(1, ...Object.values(categoryScores));
    const typeMax = Math.max(1, ...Object.values(typeScores));
    const countryMax = Math.max(1, ...Object.values(countryScores));
    const keywordEntries = Object.entries(keywordScores).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const keywordMax = Math.max(1, ...keywordEntries.map(([, score]) => score));
    const categoryWeights = {};
    const typeWeights = {};
    const countryWeights = {};
    const keywordWeights = {};

    Object.entries(categoryScores).forEach(([categoryId, score]) => {
        categoryWeights[categoryId] = Number(score) / categoryMax;
    });
    Object.entries(typeScores).forEach(([type, score]) => {
        typeWeights[type] = Number(score) / typeMax;
    });
    Object.entries(countryScores).forEach(([country, score]) => {
        countryWeights[country] = Number(score) / countryMax;
    });
    keywordEntries.forEach(([token, score]) => {
        keywordWeights[token] = Number(score) / keywordMax;
    });

    const preferredYear = yearValues.length > 0
        ? Math.round(yearValues.reduce((sum, value) => sum + value, 0) / yearValues.length)
        : null;
    const preferredRating = ratingValues.length > 0
        ? ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length
        : null;

    state.preferences = {
        categoryWeights,
        typeWeights,
        countryWeights,
        keywordWeights,
        preferredYear,
        preferredRating
    };
}

function getKeywordMatchScore(movie) {
    const weights = state.preferences.keywordWeights || {};
    const tokens = collectMovieTokens(movie);
    if (tokens.length === 0) return 0;
    let score = 0;
    const seen = new Set();
    tokens.forEach((token) => {
        if (seen.has(token)) return;
        seen.add(token);
        score += (weights[token] || 0) * 9;
    });
    return Math.min(score, 40);
}

function getCountryMatchScore(movie) {
    const weights = state.preferences.countryWeights || {};
    const countries = Array.isArray(movie.countries) ? movie.countries : [];
    if (countries.length === 0) return 0;
    return countries.reduce((sum, country) => sum + ((weights[country.toLowerCase()] || 0) * 14), 0);
}

function getPersonalPenalty(movie) {
    let penalty = 0;
    if (state.favoriteIds.has(movie.id)) penalty += 600;
    if (state.likedIds.has(movie.id)) penalty += 600;
    if (state.skippedIds.has(movie.id)) penalty += 700;
    if (state.seenMovieIds.has(movie.id)) penalty += 450;
    if (state.interactions.dislikedMovieIds.has(movie.id)) penalty += 220;
    if (state.interactions.likedMovieIds.has(movie.id)) penalty -= 90;

    const openCount = state.interactions.openedCounts.get(movie.id) || 0;
    const shownCount = state.interactions.shownCounts.get(movie.id) || 0;
    penalty += Math.min(openCount * 14, 110);
    penalty += Math.min(shownCount * 18, 130);

    const recentSet = new Set(state.interactions.recentShownIds.slice(-RECENT_SHOWN_PENALTY_WINDOW));
    if (recentSet.has(movie.id)) penalty += 180;
    return penalty;
}

function scoreMovie(movie) {
    const normalizedMovie = normalizeMovie(movie);
    let score = 0;
    const rating = Number(normalizedMovie.rating);
    if (!Number.isNaN(rating)) {
        score += rating * 3;
        if (state.preferences.preferredRating) {
            score += Math.max(0, 16 - Math.abs(rating - state.preferences.preferredRating) * 7);
        }
    }

    const year = Number(normalizedMovie.year);
    if (Number.isFinite(year) && year > 1900 && year < 2100) {
        score += Math.max(0, (year - 1990) * 0.12);
        if (state.preferences.preferredYear) {
            score += Math.max(0, 18 - Math.abs(year - state.preferences.preferredYear) * 1.4);
        }
    }

    const selected = [...state.selectedCategoryIds];
    if (selected.length > 0) {
        const matches = selected.filter((id) => normalizedMovie.categoryIds.includes(id));
        if (matches.length > 0) {
            score += 100 + matches.length * 24;
        } else {
            score -= 45;
        }
    }

    normalizedMovie.categoryIds.forEach((categoryId) => {
        score += (state.preferences.categoryWeights[categoryId] || 0) * 46;
    });

    if (normalizeSelectedCountryValue(state.selectedCountry)) {
        if (movieMatchesSelectedCountry(normalizedMovie)) {
            score += 170;
        } else if (normalizedMovie.countries.length > 0) {
            score -= 80;
        } else {
            score -= 20;
        }
    }

    score += (state.preferences.typeWeights[normalizedMovie.contentType] || 0) * 24;
    score += getCountryMatchScore(normalizedMovie);
    score += getKeywordMatchScore(normalizedMovie);
    score -= getPersonalPenalty(normalizedMovie);
    score += (Math.random() * 14) - 7;
    return score;
}

function shuffleByScoreWithNoise(items, noise = 9) {
    return [...items]
        .map((item) => ({ ...item, _mixedScore: item.recommendationScore + ((Math.random() * noise) - noise / 2) }))
        .sort((a, b) => b._mixedScore - a._mixedScore)
        .map(({ _mixedScore, ...item }) => item);
}

function sampleRandom(items, count) {
    const pool = [...items];
    const sampled = [];
    while (pool.length > 0 && sampled.length < count) {
        const idx = Math.floor(Math.random() * pool.length);
        sampled.push(pool.splice(idx, 1)[0]);
    }
    return sampled;
}

function buildSmartRecommendationFeed(scoredMovies) {
    if (scoredMovies.length <= 2) return scoredMovies;
    const sorted = [...scoredMovies].sort((a, b) => b.recommendationScore - a.recommendationScore);
    const highSize = Math.max(1, Math.ceil(sorted.length * 0.58));
    const midSize = Math.max(1, Math.ceil(sorted.length * 0.27));
    const randomSize = Math.max(1, Math.ceil(sorted.length * 0.15));

    const high = sorted.slice(0, highSize);
    const mid = sorted.slice(highSize, highSize + midSize);
    const tail = sorted.slice(highSize + midSize);

    const merged = [
        ...shuffleByScoreWithNoise(high, 8),
        ...shuffleByScoreWithNoise(mid, 12),
        ...sampleRandom(tail, randomSize),
        ...tail
    ];

    const unique = [];
    const seenIds = new Set();
    merged.forEach((movie) => {
        if (seenIds.has(movie.id)) return;
        seenIds.add(movie.id);
        unique.push(movie);
    });
    return unique;
}

function sortMoviesForUser(movies) {
    const scored = [...movies]
        .map((movie) => ({ ...movie, recommendationScore: scoreMovie(movie) }))
        .sort((a, b) => b.recommendationScore - a.recommendationScore);
    return buildSmartRecommendationFeed(scored);
}

function sortColdStartMovies(movies) {
    return [...movies]
        .map((movie) => {
            const year = Number(movie.year);
            const rating = Number(movie.rating);
            const recency = Number.isFinite(year) ? Math.max(0, year - 2000) * 0.35 : 0;
            const popularity = Number.isFinite(rating) ? rating * 3.5 : 0;
            const variety = Math.random() * 14;
            return {
                ...movie,
                recommendationScore: popularity + recency + variety
            };
        })
        .sort((a, b) => b.recommendationScore - a.recommendationScore);
}

function renderCategoryFilters() {
    if (!moodFilters) return;

    // Country filter section is disabled in UI.
    state.selectedCountry = '';

    const selected = [...state.selectedCategoryIds];
    const selectedSet = new Set(selected);
    const nonSelected = state.allCategories.filter((category) => !selectedSet.has(category.id) && category.id !== 'all');
    const sorted = [
        ...selected.map((id) => CATEGORY_BY_ID.get(id)).filter(Boolean),
        CATEGORY_BY_ID.get('all'),
        ...nonSelected
    ].filter(Boolean);

    state.selectedCountry = normalizeSelectedCountryValue(state.selectedCountry);
    moodFilters.innerHTML = '';

    sorted.forEach((category) => {
        const button = document.createElement('button');
        button.className = 'mood-tag';
        button.type = 'button';
        button.dataset.categoryId = category.id;
        button.textContent = `${category.icon} ${category.label}`;

        const isSelected = selectedSet.has(category.id);
        if (isSelected) {
            button.classList.add('selected', 'pinned');
        }
        if (category.id === 'all' && selected.length === 0) {
            button.classList.add('active');
        }

        button.addEventListener('click', () => toggleCategory(category.id));
        moodFilters.appendChild(button);
    });
}

function closeCountryPicker() {
    if (!countryPickerOverlay) return;
    countryPickerOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

function selectCountry(countryName) {
    const normalized = normalizeSelectedCountryValue(countryName);
    state.selectedCountry = normalized;
    closeCountryPicker();
    state.page = 1;
    renderCategoryFilters();
    loadMovies();
}

function renderCountryPickerList() {
    if (!countryPickerList) return;
    const selectedCountry = normalizeTextForCompare(state.selectedCountry);
    countryPickerList.innerHTML = '';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'country-item';
    if (!selectedCountry) resetBtn.classList.add('selected');
    resetBtn.innerHTML = `
        <span class="country-flag">🌍</span>
        <span class="country-name">Любая страна</span>
    `;
    resetBtn.addEventListener('click', () => selectCountry(''));
    countryPickerList.appendChild(resetBtn);

    COUNTRY_FILTER_OPTIONS.forEach((country) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'country-item';
        const isSelected = normalizeTextForCompare(country.name) === selectedCountry;
        if (isSelected) btn.classList.add('selected');
        btn.innerHTML = `
            <span class="country-flag">${country.flag}</span>
            <span class="country-name">${country.name}</span>
        `;
        btn.addEventListener('click', () => selectCountry(country.name));
        countryPickerList.appendChild(btn);
    });
}

function openCountryPicker() {
    if (!countryPickerOverlay) return;
    renderCountryPickerList();
    countryPickerOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function getPreferredContentType() {
    const selectedCategories = getSelectedCategories();
    const selectedTypes = [...new Set(selectedCategories.map((category) => category.contentType).filter(Boolean))];
    const normalizedTypes = selectedTypes.map((type) => {
        if (type === 'CARTOON') return 'FILM';
        return type;
    });
    const uniqueTypes = [...new Set(normalizedTypes)];
    if (uniqueTypes.length === 1 && ['ALL', 'FILM', 'TV_SERIES'].includes(uniqueTypes[0])) {
        return uniqueTypes[0];
    }
    return 'ALL';
}

function getCategoryQueryValue(categoryIds = state.selectedCategoryIds) {
    const selected = categoryIds instanceof Set ? [...categoryIds] : [...(categoryIds || [])];
    return selected.length > 0 ? selected.join(',') : 'all';
}

function getReadableMovieLoadError(error) {
    const raw = (error?.message || '').toString().trim();
    if (!raw) {
        return 'Не удалось загрузить фильмы. Попробуйте снова чуть позже.';
    }
    const networkHints = ['Failed to fetch', 'NetworkError', 'Load failed', 'Network request failed'];
    if (networkHints.some((hint) => raw.includes(hint))) {
        return 'Сервер фильмов недоступен. Проверьте интернет и повторите попытку.';
    }
    return raw;
}

/**
 * Загружает список фильмов с учетом выбранных категорий.
 */
async function fetchMovies(options = 1) {
    const page = typeof options === 'number' ? options : (options?.page || 1);
    const limit = options?.limit || 40;
    const categories = options?.categories
        ? getCategoryQueryValue(options.categories)
        : getCategoryQueryValue();
    const contentType = options?.contentType || getPreferredContentType();
    const mood = options?.mood || 'all';

    const query = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        mood,
        categories,
        content_type: contentType
    });
    const requestUrl = `${BACKEND_API_BASE}/api/movies?${query.toString()}`;
    const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        },
        cache: 'no-store'
    });

    if (response.status === 404) {
        throw new Error('Oracle backend не обновлён: отсутствует endpoint /api/movies');
    }

    if (response.status === 503) {
        throw new Error('На backend не настроен KINOPOISK_API_KEY');
    }

    if (response.status === 502 || response.status === 504) {
        throw new Error('Сервер фильмов временно недоступен. Попробуйте позже.');
    }

    if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.items)) {
        throw new Error('Некорректный ответ сервера: отсутствует массив items');
    }

    return data.items
        .map(normalizeMovie)
        .filter((movie) => Number.isFinite(movie.id));
}

function mergeUniqueMovies(list) {
    const unique = new Map();
    list.forEach((movie) => {
        if (!movie || !Number.isFinite(movie.id)) return;
        if (!unique.has(movie.id)) unique.set(movie.id, movie);
    });
    return [...unique.values()];
}

function pickRandomCategoryId() {
    const pool = state.allCategories
        .map((category) => category.id)
        .filter((id) => id !== 'all' && id !== 'series');
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

function buildFetchPlans(basePage) {
    if (state.selectedCountry) {
        return [{ page: basePage, limit: 40 }];
    }

    const plans = [{ page: basePage, limit: 40 }];

    if (!hasUserPreferenceSignals() && state.selectedCategoryIds.size === 0) {
        const randomCategory = pickRandomCategoryId();
        if (randomCategory && Math.random() < 0.35) {
            plans.push({
                page: basePage,
                limit: 40,
                categories: [randomCategory]
            });
        }
    }
    return plans;
}

async function fetchCandidateMovies(basePage) {
    const plans = buildFetchPlans(basePage);
    const results = await Promise.all(
        plans.map(async (plan) => {
            try {
                const items = await fetchMovies(plan);
                return { ok: true, items };
            } catch (error) {
                console.error('Ошибка загрузки плана фильмов:', plan, error);
                return { ok: false, items: [], error };
            }
        })
    );

    const successful = results.filter((result) => result.ok);
    if (successful.length === 0) {
        const firstError = results.find((result) => result.error)?.error;
        throw firstError || new Error('Сервер временно недоступен');
    }

    return mergeUniqueMovies(successful.flatMap((result) => result.items));
}

/**
 * Загружает детальную информацию о фильме.
 */
async function fetchMovieDetails(filmId) {
    try {
        const normalizedFilmId = Number(filmId);
        if (!Number.isFinite(normalizedFilmId)) return null;
        const url = `${BACKEND_API_BASE}/api/movies/${normalizedFilmId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            },
            cache: 'no-store'
        });

        if (!response.ok) return null;
        const data = await response.json();
        const normalized = normalizeMovie({
            ...data,
            kinopoiskId: normalizedFilmId
        });
        if (!Number.isFinite(normalized.id)) {
            normalized.id = normalizedFilmId;
            normalized.kinopoiskId = normalizedFilmId;
        }
        return normalized;
    } catch {
        return null;
    }
}

const trailersCache = new Map();
let currentTrailerRequestId = 0;

async function fetchMovieTrailers(filmId) {
    const normalizedFilmId = Number(filmId);
    if (!Number.isFinite(normalizedFilmId)) return [];
    if (trailersCache.has(normalizedFilmId)) {
        return trailersCache.get(normalizedFilmId);
    }
    try {
        const url = `${BACKEND_API_BASE}/api/movies/${normalizedFilmId}/videos`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        });
        if (!response.ok) {
            trailersCache.set(normalizedFilmId, []);
            return [];
        }
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        trailersCache.set(normalizedFilmId, items);
        return items;
    } catch {
        trailersCache.set(normalizedFilmId, []);
        return [];
    }
}

function pickPreferredTrailer(trailers) {
    if (!Array.isArray(trailers) || trailers.length === 0) return null;
    return trailers.find((item) => buildEmbedUrl(item)) || null;
}

function openExternalTrailerUrl(url) {
    if (!url) return;
    try {
        if (window.AndroidAds && typeof window.AndroidAds.openExternalUrl === 'function') {
            window.AndroidAds.openExternalUrl(url);
            return;
        }
    } catch (error) {
        console.warn('Android openExternalUrl bridge error:', error);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

function buildEmbedUrl(trailer) {
    const rawUrl = (trailer?.url || '').toString().trim();
    if (!rawUrl) return '';
    // YouTube убран (в РФ недоступен) — трейлеры проигрываем из виджета
    // Kinopoisk или из RuTube (встраиваемый плеер, работает в России).
    if (/rutube\.ru\/play\/embed\//i.test(rawUrl)) {
        try {
            const url = new URL(rawUrl);
            url.searchParams.set('autoplay', '1');
            return url.toString();
        } catch {
            return rawUrl;
        }
    }
    // Kinopoisk own widget: https://widgets.kinopoisk.ru/discovery/trailer/{id}?...
    // Iframe-embeddable, gives Russian dub. Some CDN URLs (trailers.s3.mds.yandex.net)
    // may be unreachable on certain networks — in that case the widget just shows a spinner.
    if (/widgets\.kinopoisk\.ru\/.+trailer/i.test(rawUrl)) {
        try {
            const url = new URL(rawUrl);
            url.searchParams.set('onlyPlayer', '1');
            url.searchParams.set('autoplay', '1');
            url.searchParams.set('cover', '1');
            return url.toString();
        } catch {
            return rawUrl;
        }
    }
    return '';
}

function openTrailerPlayer(trailer) {
    if (!trailer || !trailer.url || !trailerOverlay || !trailerFrame) return;
    const embedUrl = buildEmbedUrl(trailer);
    if (!embedUrl) return;
    trailerFrame.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.setAttribute('title', 'Трейлер');
    iframe.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    trailerFrame.appendChild(iframe);
    trailerOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeTrailerPlayer() {
    if (!trailerOverlay) return;
    trailerOverlay.classList.remove('active');
    if (trailerFrame) trailerFrame.innerHTML = '';
    if (!popupOverlay?.classList.contains('active')) {
        document.body.style.overflow = '';
    }
}

function hidePopupTrailerButton() {
    if (!popupTrailerBtn) return;
    popupTrailerBtn.style.display = 'none';
    popupTrailerBtn.onclick = null;
}

// Оценка онлайн-доступности фильма. Точного признака у Kinopoisk API нет,
// поэтому используем надёжные негативные сигналы: фильм не завершён / ещё не
// вышел / сейчас идёт в кинотеатрах — значит смотреть онлайн пока негде.
// Наличие kinopoiskHDId — явный признак доступности (есть на Кинопоиск HD).
function isMovieWatchable(movie) {
    if (!movie) return false;
    if (movie.kinopoiskHDId) return true;
    const status = String(movie.productionStatus || '').toUpperCase();
    if (movie.completed === false) return false;
    if (status && status !== 'COMPLETED') return false; // ANNOUNCED / FILMING / *_PRODUCTION
    if (movie.isTicketsAvailable === true) return false; // сейчас в прокате
    return true; // вышедший фильм — скорее всего доступен онлайн
}

// Кнопка «Смотреть»: открывает страницу фильма на Кинопоиске, где есть
// официальный блок «Смотреть» со ссылками на онлайн-кинотеатры (Окко, Иви,
// КИОН, START, PREMIER и др.) — именно там, где фильм реально доступен.
// Если смотреть онлайн негде — кнопка показывается неактивной.
function setupPopupWatchButton(movie) {
    if (!popupWatchBtn) return;
    const kinopoiskId = Number(movie?.kinopoiskId || movie?.id);
    if (!Number.isFinite(kinopoiskId) || kinopoiskId <= 0) {
        popupWatchBtn.style.display = 'none';
        popupWatchBtn.onclick = null;
        return;
    }

    popupWatchBtn.style.display = '';
    if (isMovieWatchable(movie)) {
        popupWatchBtn.classList.remove('is-disabled');
        popupWatchBtn.disabled = false;
        popupWatchBtn.onclick = () => openExternalUrl(`https://www.kinopoisk.ru/film/${kinopoiskId}/`);
    } else {
        popupWatchBtn.classList.add('is-disabled');
        popupWatchBtn.disabled = true;
        popupWatchBtn.onclick = null;
    }
}

function hidePopupWatchButton() {
    if (!popupWatchBtn) return;
    popupWatchBtn.style.display = 'none';
    popupWatchBtn.onclick = null;
}

async function loadPopupTrailerForMovie(movieId) {
    if (!popupTrailerBtn) return;
    const requestId = ++currentTrailerRequestId;
    hidePopupTrailerButton();
    const trailers = await fetchMovieTrailers(movieId);
    if (requestId !== currentTrailerRequestId) return;
    if (!popupOverlay?.classList.contains('active')) return;
    if (currentPopupContext.movie?.id !== movieId) return;
    const preferred = pickPreferredTrailer(trailers);
    if (!preferred) return;
    popupTrailerBtn.style.display = '';
    popupTrailerBtn.onclick = () => openTrailerPlayer(preferred);
}

function hasUsablePosterValue(value) {
    const poster = (value || '').toString().trim();
    if (!poster) return false;
    const normalized = poster.toLowerCase();
    if (!(normalized.startsWith('http://') || normalized.startsWith('https://'))) {
        return false;
    }
    if (
        normalized === 'null' ||
        normalized === 'undefined' ||
        normalized.endsWith('/null') ||
        normalized.endsWith('/undefined') ||
        normalized.includes('nophoto') ||
        normalized.includes('no_photo') ||
        normalized.includes('no-poster') ||
        normalized.includes('poster_none') ||
        normalized.includes('placeholder') ||
        normalized.includes('/none')
    ) {
        return false;
    }
    return true;
}

function getCardPosterUrl(movie) {
    if (!movie || typeof movie !== 'object') return '';
    const candidates = [
        movie.poster,
        movie.posterUrlPreview,
        movie.posterFull,
        movie.posterUrl
    ];
    for (const candidate of candidates) {
        if (hasUsablePosterValue(candidate)) {
            return candidate.toString().trim();
        }
    }
    return '';
}

function hasMoviePoster(movie) {
    return Boolean(getCardPosterUrl(movie));
}

function extractMeaningfulDescription(details, movie) {
    const candidates = [
        movie?.description,
        details?.description,
        details?.shortDescription,
        details?.slogan
    ];
    for (const candidate of candidates) {
        const text = (candidate || '').toString().trim();
        if (!text) continue;
        if (
            text === DESCRIPTION_PLACEHOLDER ||
            text === DESCRIPTION_FALLBACK
        ) {
            continue;
        }
        return text;
    }
    return '';
}

function mergeMovieWithDetails(movie, details) {
    if (!movie || !details) return movie;
    const normalized = normalizeMovie({
        ...movie,
        ...details,
        kinopoiskId: movie.id,
        poster: details.poster || movie.poster,
        posterFull: details.posterFull || movie.posterFull,
        posterUrl: details.posterUrl || details.posterFull || movie.posterUrl || movie.posterFull || movie.poster,
        posterUrlPreview: details.posterUrlPreview || details.poster || movie.posterUrlPreview || movie.poster
    });
    const description = extractMeaningfulDescription(details, movie);
    if (description) {
        normalized.description = description;
    }
    const posterForCard = getCardPosterUrl(normalized);
    if (posterForCard) {
        normalized.poster = posterForCard;
    }
    return normalized;
}

function needsDiscoverMovieEnrichment(movie) {
    const hasRating = Boolean(getMovieRatingText(movie));
    const hasCountry = Boolean(getPrimaryCountryName(movie));
    const hasGenres = Boolean(
        movie?.genresText ||
        (Array.isArray(movie?.genres) && movie.genres.length > 0) ||
        (typeof movie?.genres === 'string' && movie.genres.trim())
    );
    return !hasMoviePoster(movie)
        || !extractMeaningfulDescription(null, movie)
        || !hasRating
        || !hasCountry
        || !hasGenres;
}

function isDiscoverCardDisplayable(movie) {
    if (!movie || !Number.isFinite(movie.id)) return false;
    return hasMoviePoster(movie);
}

async function enrichAndFilterDiscoverMovies(movies) {
    if (!Array.isArray(movies) || movies.length === 0) return [];

    const filtered = movies
        .filter((movie) => {
            if (isDiscoverCardDisplayable(movie)) return true;
            markMovieAsSeen(movie.id);
            return false;
        });

    const enriched = await Promise.all(filtered.map(async (movie) => {
        if (!needsDiscoverMovieEnrichment(movie)) return movie;
        const details = await fetchMovieDetails(movie.id);
        return details ? mergeMovieWithDetails(movie, details) : movie;
    }));

    return enriched.filter((movie) => {
        if (isDiscoverCardDisplayable(movie)) return true;
        markMovieAsSeen(movie.id);
        return false;
    });
}

// ============================================================
// Загрузка и отображение карточек
// ============================================================

function getTopGenresForRecommendations(limit = 5) {
    const weights = state.preferences?.categoryWeights || {};
    const entries = Object.entries(weights)
        .filter(([id, weight]) => id !== 'all' && weight >= 0.3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => id);
    return entries;
}

async function fetchRecommendationsBatch() {
    const likedIds = state.likedOrderIds.slice(0, 10);
    const topGenres = getTopGenresForRecommendations(5);

    if (likedIds.length === 0 && topGenres.length === 0) {
        return { movies: [], pageCursor: 1 };
    }

    try {
        // POST с телом — напрямую в бэкенд (WebView-прокси не пересылает body).
        const response = await fetch(`${BACKEND_POST_BASE}/api/recommendations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json'
            },
            cache: 'no-store',
            body: JSON.stringify({
                liked_ids: likedIds,
                top_genres: topGenres,
                blocked_genres: [],
                limit: 20
            })
        });

        if (!response.ok) {
            console.warn('Recommendations request failed:', response.status);
            return { movies: [], pageCursor: 1 };
        }

        const data = await response.json();
        if (!Array.isArray(data.items)) {
            return { movies: [], pageCursor: 1 };
        }

        const normalized = data.items
            .map(normalizeMovie)
            .filter((movie) => Number.isFinite(movie.id));
        const unseen = filterUnseenMovies(normalized);

        return { movies: unseen, pageCursor: 1 };
    } catch (error) {
        console.warn('Recommendations fetch error:', error);
        return { movies: [], pageCursor: 1 };
    }
}

async function fetchPreparedMoviesBatch(startPage, options = {}) {
    const {
        excludeIds = new Set()
    } = options;

    const normalizedExcludeIds = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
    const collected = new Map();
    let pageCursor = startPage;
    // Идём вперёд по нескольким страницам, пока не наберём достаточно новых
    // фильмов. Раньше здесь была всего 1 попытка — из-за этого лента считала,
    // что «фильмы закончились», хотя дальше по страницам полно новых.
    const maxAttempts = state.selectedCountry ? 12 : 8;
    const targetCount = state.selectedCountry ? 12 : 8;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const fetched = await fetchCandidateMovies(pageCursor);
        const unseen = filterUnseenMovies(fetched);
        const withoutRecent = filterRecentlyShownMovies(unseen);
        const filtered = applyCountryPreferenceFilter(withoutRecent);

        filtered.forEach((movie) => {
            if (!movie || !Number.isFinite(movie.id)) return;
            if (normalizedExcludeIds.has(movie.id)) return;
            if (!collected.has(movie.id)) {
                collected.set(movie.id, movie);
            }
        });

        pageCursor += 1;
        if (collected.size >= targetCount || fetched.length === 0) {
            break;
        }
    }

    let movies = [...collected.values()];

    if (movies.length === 0) {
        // «Популярное» исчерпано (все новинки уже просмотрены). Добираем
        // свежие фильмы из разных категорий — там другие фильмы, поэтому
        // лента продолжается вместо «Фильмы закончились».
        const rescueCollected = new Map();
        const rescueTargetCount = state.selectedCountry ? 12 : 8;

        const addFresh = (fetched) => {
            const fresh = applyCountryPreferenceFilter(filterUnseenMovies(fetched));
            fresh.forEach((movie) => {
                if (!movie || !Number.isFinite(movie.id)) return;
                if (normalizedExcludeIds.has(movie.id)) return;
                if (!rescueCollected.has(movie.id)) rescueCollected.set(movie.id, movie);
            });
        };

        // Перемешанный список категорий (без 'all' и 'series').
        const categoryPool = state.allCategories
            .map((category) => category.id)
            .filter((id) => id && id !== 'all' && id !== 'series');
        for (let i = categoryPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [categoryPool[i], categoryPool[j]] = [categoryPool[j], categoryPool[i]];
        }

        // Перебираем несколько категорий, по 1-2 страницы, пока не наберём.
        for (const categoryId of categoryPool.slice(0, 6)) {
            if (rescueCollected.size >= rescueTargetCount) break;
            for (let page = 1; page <= 2; page++) {
                let fetched;
                try {
                    fetched = await fetchMovies({ page, limit: 40, categories: [categoryId] });
                } catch (error) {
                    console.warn('Rescue: категория недоступна', categoryId, error);
                    break;
                }
                addFresh(fetched);
                if (fetched.length === 0 || rescueCollected.size >= rescueTargetCount) break;
            }
        }

        movies = [...rescueCollected.values()];
    }

    movies = filterUnseenMovies(movies)
        .filter((movie) => !normalizedExcludeIds.has(movie.id));
    movies = await enrichAndFilterDiscoverMovies(movies);
    return { movies, pageCursor };
}

async function prefetchNextMoviesIfNeeded() {
    if (state.isLoading || state.isPrefetching) return;
    if (state.currentTab !== 'discover') return;

    const remaining = state.movies.length - state.currentIndex;
    const prefetchThreshold = 3;
    if (remaining > prefetchThreshold) return;

    state.isPrefetching = true;
    try {
        const queuedIds = new Set(
            state.movies
                .slice(state.currentIndex)
                .map((movie) => movie?.id)
                .filter((id) => Number.isFinite(id))
        );
        const { movies, pageCursor } = await fetchPreparedMoviesBatch(state.page, { excludeIds: queuedIds });
        if (movies.length === 0) return;

        const incoming = movies.filter((movie) => !queuedIds.has(movie.id));
        if (incoming.length === 0) return;

        state.page = pageCursor;
        state.movies.push(...incoming);
        saveDiscoverFeedCache();
    } catch (err) {
        console.error('Prefetch failed:', err);
    } finally {
        state.isPrefetching = false;
    }
}

async function loadMovies() {
    if (state.isLoading) return;
    state.isLoading = true;

    loader.classList.remove('hidden');
    loader.style.display = '';
    swipeActions.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    cardStack.innerHTML = '';

    try {
        computePreferences();

        const useRecommendations = state.likedOrderIds.length >= 3
            && state.selectedCategoryIds.size === 0
            && !state.selectedCountry;

        let movies;
        let pageCursor;

        if (useRecommendations) {
            const recResult = await fetchRecommendationsBatch();
            if (recResult.movies.length >= 5) {
                movies = recResult.movies;
                pageCursor = state.page;
            } else {
                const fallback = await fetchPreparedMoviesBatch(state.page);
                movies = mergeUniqueMovies([...recResult.movies, ...fallback.movies]);
                pageCursor = fallback.pageCursor;
            }
        } else {
            const result = await fetchPreparedMoviesBatch(state.page);
            movies = result.movies;
            pageCursor = result.pageCursor;
        }

        if (movies.length === 0) {
            showEmpty();
            return;
        }

        state.page = pageCursor;
        state.movies = hasUserPreferenceSignals()
            ? sortMoviesForUser(movies)
            : sortColdStartMovies(movies);
        state.currentIndex = 0;
        state.lastShownMovieId = null;
        saveDiscoverFeedCache();
        renderCards();

        loader.style.display = 'none';
        swipeActions.style.display = 'flex';
    } catch (err) {
        console.error('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438:', err);
        loader.style.display = 'none';
        errorState.style.display = '';
        errorMessage.textContent = getReadableMovieLoadError(err);
    } finally {
        state.isLoading = false;
    }
}

function showEmpty() {
    loader.style.display = 'none';
    swipeActions.style.display = 'none';
    emptyState.style.display = '';
    cardStack.innerHTML = '';
}

// ============================================================
// Рендеринг карточек (стек)
// ============================================================

function renderCards() {
    cardStack.innerHTML = '';

    const remaining = state.movies.slice(state.currentIndex);
    const sanitizedRemaining = remaining.filter((movie) => isDiscoverCardDisplayable(movie));
    if (sanitizedRemaining.length !== remaining.length) {
        state.movies = [
            ...state.movies.slice(0, state.currentIndex),
            ...sanitizedRemaining
        ];
        saveDiscoverFeedCache();
    }
    const visible = sanitizedRemaining.slice(0, 3);

    visible.forEach((movie, i) => {
        const card = createCardElement(movie, i);
        cardStack.appendChild(card);
    });

    const topCard = cardStack.querySelector('.movie-card');
    if (topCard) {
        const topMovie = visible[0];
        if (topMovie && topMovie.id !== state.lastShownMovieId) {
            markMovieAsShown(topMovie.id);
            markMovieAsSeen(topMovie.id);
            state.lastShownMovieId = topMovie.id;
        }
        enableSwipe(topCard);
        void prefetchNextMoviesIfNeeded();
    } else if (!state.isLoading) {
        loadMovies();
    }
}

function pickBestDescription(details, movie) {
    return extractMeaningfulDescription(details, movie) || DESCRIPTION_FALLBACK;
}

function createCardElement(movie, stackIndex) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.dataset.id = movie.id;
    card.dataset.suppressClick = '0';

    const scale = 1 - stackIndex * 0.04;
    const translateY = stackIndex * 10;
    card.style.transform = `translateY(${translateY}px) scale(${scale})`;
    card.style.zIndex = 10 - stackIndex;
    card.style.opacity = stackIndex < 3 ? 1 : 0;

    const ratingText = getMovieRatingText(movie);
    const ratingHtml = ratingText
        ? `<span class="card-rating">
            <svg width="14" height="14" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ${ratingText}
        </span>`
        : '';
    const genresText = movie.genresText || (Array.isArray(movie.genres) ? movie.genres.join(', ') : (movie.genres || ''));
    const countryWithFlag = formatCountryWithFlag(movie);
    const cardMetaText = [genresText, movie.ratingAgeLimits || ''].filter(Boolean).join(' • ');
    const cardPoster = getCardPosterUrl(movie);

    card.innerHTML = `
        <div class="card-bg" style="background-image: url('${cardPoster}')"></div>
        <div class="card-gradient"></div>
        <span class="swipe-stamp like">\u2764\uFE0F</span>
        <span class="swipe-stamp dislike">\u2715</span>
        <span class="swipe-stamp watchlist">\u2B50</span>
        <span class="swipe-stamp watched">\uD83D\uDC41\uFE0F</span>
        <div class="card-info">
            <div class="card-title">${movie.title}</div>
            <div class="card-meta">
                ${ratingHtml}
                ${countryWithFlag ? `<span class="card-country">${countryWithFlag}</span>` : ''}
                ${movie.year ? `<span class="card-year">${movie.year}</span>` : ''}
            </div>
            ${cardMetaText ? `<div class="card-genres">${cardMetaText}</div>` : ''}
            ${movie.description && movie.description !== '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442'
            ? `<div class="card-desc">${movie.description}</div>`
            : ''
        }
        </div>
    `;

    card.addEventListener('click', () => {
        if (card.dataset.suppressClick === '1') {
            card.dataset.suppressClick = '0';
            return;
        }
        openPopup(movie);
    });

    return card;
}

// ============================================================
// Свайп-механика (touch + mouse)
// ============================================================

function handleCardAction(action, card) {
    const currentMovie = state.movies[state.currentIndex];
    if (!currentMovie || !card) return;

    if (action === 'liked') {
        setMovieStatusLocally(currentMovie, 'liked');
        void syncStatusToFirestore(currentMovie.id, 'liked');
    } else if (action === 'watchlist') {
        setMovieStatusLocally(currentMovie, 'watchlist');
        void syncStatusToFirestore(currentMovie.id, 'watchlist');
    } else if (action === 'watched') {
        setMovieStatusLocally(currentMovie, 'watched');
        void syncStatusToFirestore(currentMovie.id, 'watched');
    } else {
        setMovieStatusLocally(currentMovie, 'skipped');
        void syncStatusToFirestore(currentMovie.id, 'skipped');
    }

    flyAway(card, action);
}

function enableSwipe(card) {
    let startX = 0, startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isDragging = false;
    let moved = false;

    const stampLike = card.querySelector('.swipe-stamp.like');
    const stampDislike = card.querySelector('.swipe-stamp.dislike');
    const stampWatchlist = card.querySelector('.swipe-stamp.watchlist');
    const stampWatched = card.querySelector('.swipe-stamp.watched');

    function onStart(e) {
        isDragging = true;
        moved = false;
        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;
        currentY = 0;
        card.style.transition = 'none';
        stampLike.classList.remove('visible');
        stampDislike.classList.remove('visible');
        if (stampWatchlist) stampWatchlist.classList.remove('visible');
        if (stampWatched) stampWatched.classList.remove('visible');
    }

    function onMove(e) {
        if (!isDragging) return;
        const point = e.touches ? e.touches[0] : e;
        currentX = point.clientX - startX;
        currentY = point.clientY - startY;
        if (Math.abs(currentX) > 8 || Math.abs(currentY) > 8) {
            moved = true;
        }

        const rotation = currentX * 0.08;
        card.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotation}deg)`;

        const threshold = 60;
        const upThreshold = 70;
        const downThreshold = 70;
        const isUpIntent = currentY < -upThreshold && Math.abs(currentY) > Math.abs(currentX) * 1.12;
        const isDownIntent = currentY > downThreshold && Math.abs(currentY) > Math.abs(currentX) * 1.12;

        if (isUpIntent) {
            if (stampWatchlist) stampWatchlist.classList.add('visible');
            stampLike.classList.remove('visible');
            stampDislike.classList.remove('visible');
            if (stampWatched) stampWatched.classList.remove('visible');
        } else if (isDownIntent) {
            if (stampWatched) stampWatched.classList.add('visible');
            stampLike.classList.remove('visible');
            stampDislike.classList.remove('visible');
            if (stampWatchlist) stampWatchlist.classList.remove('visible');
        } else if (currentX > threshold) {
            stampLike.classList.add('visible');
            stampDislike.classList.remove('visible');
            if (stampWatchlist) stampWatchlist.classList.remove('visible');
            if (stampWatched) stampWatched.classList.remove('visible');
        } else if (currentX < -threshold) {
            stampDislike.classList.add('visible');
            stampLike.classList.remove('visible');
            if (stampWatchlist) stampWatchlist.classList.remove('visible');
            if (stampWatched) stampWatched.classList.remove('visible');
        } else {
            stampLike.classList.remove('visible');
            stampDislike.classList.remove('visible');
            if (stampWatchlist) stampWatchlist.classList.remove('visible');
            if (stampWatched) stampWatched.classList.remove('visible');
        }
    }

    function onEnd() {
        if (!isDragging) return;
        isDragging = false;
        if (moved) {
            card.dataset.suppressClick = '1';
        }

        const swipeThreshold = 100;
        const swipeUpThreshold = 110;
        const swipeDownThreshold = 110;
        const isUpSwipe = currentY < -swipeUpThreshold && Math.abs(currentY) > Math.abs(currentX) * 1.2;
        const isDownSwipe = currentY > swipeDownThreshold && Math.abs(currentY) > Math.abs(currentX) * 1.2;

        if (isUpSwipe) {
            handleCardAction('watchlist', card);
        } else if (isDownSwipe) {
            handleCardAction('watched', card);
        } else if (currentX > swipeThreshold) {
            handleCardAction('liked', card);
        } else if (currentX < -swipeThreshold) {
            handleCardAction('skipped', card);
        } else {
            card.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            card.style.transform = 'translateY(0) scale(1)';
            stampLike.classList.remove('visible');
            stampDislike.classList.remove('visible');
            if (stampWatchlist) stampWatchlist.classList.remove('visible');
            if (stampWatched) stampWatched.classList.remove('visible');
        }

        currentX = 0;
        currentY = 0;
    }

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: true });
    card.addEventListener('touchend', onEnd);
    card.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
}

function flyAway(card, action) {
    let transform = '';
    if (action === 'liked') {
        const flyX = window.innerWidth;
        transform = `translateX(${flyX}px) rotate(30deg)`;
    } else if (action === 'watchlist') {
        const flyY = -Math.max(260, Math.round(window.innerHeight * 0.58));
        transform = `translateY(${flyY}px) scale(0.9)`;
    } else if (action === 'watched') {
        const flyY = Math.max(260, Math.round(window.innerHeight * 0.58));
        transform = `translateY(${flyY}px) scale(0.9)`;
    } else {
        const flyX = -window.innerWidth;
        transform = `translateX(${flyX}px) rotate(-30deg)`;
    }
    card.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
    card.style.transform = transform;
    card.style.opacity = '0';

    card.addEventListener('transitionend', () => {
        notifyAndroidMovieSwiped();
        state.currentIndex++;
        saveDiscoverFeedCache();
        if (state.currentIndex >= state.movies.length) {
            loadMovies();
        } else {
            renderCards();
        }
    }, { once: true });
}

// ============================================================
// Избранное (Firestore + локальный кэш)
// ============================================================

/**
 * Установить статус фильма локально + в Firestore.
 */
function setMovieStatus(movie, status) {
    if (!movie || !Number.isFinite(movie.id)) return;
    setMovieStatusLocally(movie, status);
    void syncStatusToFirestore(movie.id, status);
}

/**
 * Удалить фильм из конкретного списка.
 */
function removeFromStatusList(movieId, status) {
    const normalizedId = Number(movieId);
    if (!Number.isFinite(normalizedId) || !status) return;
    removeMovieFromStatusLocally(normalizedId, status);
    void removeStatusFromFirestore(normalizedId, status);
}

function addToWatchlist(movie) {
    setMovieStatus(movie, 'watchlist');
}

function addToLiked(movie) {
    setMovieStatus(movie, 'liked');
}

function addToWatched(movie) {
    setMovieStatus(movie, 'watched');
}

function addToSkipped(movie) {
    setMovieStatus(movie, 'skipped');
}

function updateFavBadge() {
    const count = state.favoriteIds.size + state.likedIds.size + state.watchedIds.size;
    if (count > 0) {
        favBadge.textContent = count;
        favBadge.style.display = 'inline-block';
    } else {
        favBadge.style.display = 'none';
    }
}

function renderStatusSection(grid, ids, detailsById, status, visibleCount, onShowMore) {
    if (!grid) return;
    grid.innerHTML = '';
    const visibleIds = ids.slice(0, visibleCount);

    visibleIds.forEach((id, i) => {
        const movie = detailsById.get(id);
        const card = document.createElement('div');
        card.className = movie ? 'fav-card' : 'fav-card skeleton';
        card.style.animationDelay = `${i * 0.06}s`;
        if (movie) {
            const genresText = movie.genresText || (Array.isArray(movie.genres) ? movie.genres.join(', ') : (movie.genres || ''));
            const ratingText = getMovieRatingText(movie);
            card.innerHTML = `
                <img src="${movie.poster}" alt="${movie.title}" loading="lazy">
                <div class="fav-info">
                    <div class="fav-title">${movie.title}</div>
                    ${ratingText ? `<div class="fav-rating">\u2B50 ${ratingText}</div>` : ''}
                    ${genresText ? `<div class="fav-genres">${genresText}</div>` : ''}
                </div>
            `;
            card.addEventListener('click', () => openPopup(movie, status));
        } else {
            card.innerHTML = `
                <div class="skeleton-poster"></div>
                <div class="fav-info">
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line short"></div>
                </div>
            `;
        }
        grid.appendChild(card);
    });

    if (ids.length > visibleCount) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'reset-btn';
        moreBtn.textContent = 'Показать ещё';
        moreBtn.style.gridColumn = '1 / -1';
        moreBtn.addEventListener('click', onShowMore);
        grid.appendChild(moreBtn);
    }
}

function renderFavorites() {
    const hasWatchlist = state.favoriteOrderIds.length > 0;
    const hasLiked = state.likedOrderIds.length > 0;
    const hasWatched = state.watchedOrderIds.length > 0;
    const hasSkipped = state.skippedOrderIds.length > 0;

    if (watchlistSection) watchlistSection.style.display = hasWatchlist ? '' : 'none';
    if (likedSection) likedSection.style.display = hasLiked ? '' : 'none';
    if (watchedSection) watchedSection.style.display = hasWatched ? '' : 'none';
    if (skippedSection) skippedSection.style.display = hasSkipped ? '' : 'none';

    if (!hasWatchlist && !hasLiked && !hasWatched && !hasSkipped) {
        if (watchlistGrid) watchlistGrid.innerHTML = '';
        if (likedGrid) likedGrid.innerHTML = '';
        if (watchedGrid) watchedGrid.innerHTML = '';
        if (skippedGrid) skippedGrid.innerHTML = '';
        emptyFavs.style.display = '';
        emptyFavs.classList.remove('hidden');
        return;
    }

    emptyFavs.style.display = 'none';
    emptyFavs.classList.add('hidden');

    renderStatusSection(
        watchlistGrid,
        state.favoriteOrderIds,
        state.favoriteDetailsById,
        'watchlist',
        state.favoritesVisibleCount,
        () => {
            state.favoritesVisibleCount += FAVORITES_PAGE_SIZE;
            renderFavorites();
        }
    );

    renderStatusSection(
        likedGrid,
        state.likedOrderIds,
        state.likedDetailsById,
        'liked',
        state.likedVisibleCount,
        () => {
            state.likedVisibleCount += FAVORITES_PAGE_SIZE;
            renderFavorites();
        }
    );

    renderStatusSection(
        watchedGrid,
        state.watchedOrderIds,
        state.watchedDetailsById,
        'watched',
        state.watchedVisibleCount,
        () => {
            state.watchedVisibleCount += FAVORITES_PAGE_SIZE;
            renderFavorites();
        }
    );

    renderStatusSection(
        skippedGrid,
        state.skippedOrderIds,
        state.skippedDetailsById,
        'skipped',
        state.skippedVisibleCount,
        () => {
            state.skippedVisibleCount += FAVORITES_PAGE_SIZE;
            renderFavorites();
        }
    );

    ensureFavoriteDetailsForVisible();
    ensureLikedDetailsForVisible();
    ensureWatchedDetailsForVisible();
    ensureSkippedDetailsForVisible();
}

// ============================================================
// Popup — Детали фильма
// ============================================================

let currentPopupContext = { movie: null, status: null };

function notifyAndroidMovieDescriptionOpened() {
    try {
        if (window.AndroidAds && typeof window.AndroidAds.onMovieDescriptionOpened === 'function') {
            window.AndroidAds.onMovieDescriptionOpened();
        }
    } catch (error) {
        console.warn('Android interstitial bridge error:', error);
    }
}

function notifyAndroidMovieSwiped() {
    try {
        if (window.AndroidAds && typeof window.AndroidAds.onMovieSwiped === 'function') {
            window.AndroidAds.onMovieSwiped();
        }
    } catch (error) {
        console.warn('Android swipe bridge error:', error);
    }
}

function getPopupStatusActionMeta(sourceStatus) {
    if (sourceStatus === 'liked') {
        return {
            watchlist: {
                targetStatus: 'watchlist',
                label: 'Хочу посмотреть',
                cssClass: 'is-watchlist'
            },
            watched: {
                targetStatus: 'watched',
                label: 'Отметить просмотренным',
                cssClass: 'is-watched'
            }
        };
    }
    if (sourceStatus === 'watchlist') {
        return {
            watchlist: null,
            watched: {
                targetStatus: 'watched',
                label: 'Отметить просмотренным',
                cssClass: 'is-watched'
            }
        };
    }
    if (sourceStatus === 'watched') {
        return {
            watchlist: {
                targetStatus: 'watchlist',
                label: 'Хочу посмотреть',
                cssClass: 'is-watchlist'
            },
            watched: null
        };
    }
    if (sourceStatus === 'search') {
        // Из поиска — добавление в «Хочу посмотреть» (по ТЗ).
        return {
            watchlist: {
                targetStatus: 'watchlist',
                label: 'Хочу посмотреть',
                cssClass: 'is-watchlist'
            },
            watched: null
        };
    }
    return {
        watchlist: null,
        watched: null
    };
}

function applyPopupStatusButton(button, textNode, meta) {
    if (!button || !textNode) return;
    button.classList.remove('is-watched', 'is-watchlist');

    if (!meta) {
        button.style.display = 'none';
        button.dataset.targetStatus = '';
        return;
    }

    button.style.display = '';
    button.dataset.targetStatus = meta.targetStatus;
    textNode.textContent = meta.label;
    if (meta.cssClass) {
        button.classList.add(meta.cssClass);
    }
}

function applyPopupActionButtons(sourceStatus) {
    const isSkipped = sourceStatus === 'skipped';
    const isSearch = sourceStatus === 'search';

    const popupRestoreButton = $('popup-restore');
    if (popupRestoreButton) {
        popupRestoreButton.style.display = isSkipped ? '' : 'none';
    }

    const popupDeleteButton = $('popup-delete');
    if (popupDeleteButton) {
        // «Удалить из избранного» — только для сохранённых списков.
        // Для «Пропущенных» вместо этого «Вернуть в подборку», для поиска — ничего.
        popupDeleteButton.style.display = (sourceStatus && !isSkipped && !isSearch) ? '' : 'none';
    }

    const meta = getPopupStatusActionMeta(sourceStatus);
    applyPopupStatusButton(popupToggleWatchlist, popupToggleWatchlistText, meta.watchlist);
    applyPopupStatusButton(popupToggleWatched, popupToggleWatchedText, meta.watched);
}

async function openPopup(movie, sourceStatus = null) {
    currentPopupContext = { movie, status: sourceStatus };
    markMovieOpened(movie.id);
    computePreferences();
    notifyAndroidMovieDescriptionOpened();

    popupPoster.style.backgroundImage = `url('${movie.posterFull || movie.poster}')`;
    popupTitle.textContent = movie.title;
    setPopupMetaChip(popupYear, movie.year || '');
    setPopupMetaChip(popupRating, getMovieRatingText(movie));
    setPopupMetaChip(popupCountry, formatCountryWithFlag(movie));
    setPopupMetaChip(popupGenre, getMovieMetaText(movie));
    setPopupMetaChip(popupDuration, formatMovieDuration(movie.filmLength));
    popupDesc.textContent = pickBestDescription(null, movie);
    applyPopupActionButtons(sourceStatus);

    popupOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    loadPopupTrailerForMovie(movie.id);
    setupPopupWatchButton(movie);

    // Если не хватает ключевых данных карточки — дозагружаем детали с API.
    const needsDetails =
        !movie.description ||
        movie.description === DESCRIPTION_PLACEHOLDER ||
        !getPrimaryCountryName(movie) ||
        !getMovieMetaText(movie) ||
        movie.completed === undefined; // нужно узнать онлайн-доступность для кнопки «Смотреть»
    if (needsDetails) {
        const openedMovieId = movie.id;
        const details = await fetchMovieDetails(movie.id);
        if (details) {
            if (
                !popupOverlay.classList.contains('active') ||
                currentPopupContext.movie?.id !== openedMovieId
            ) {
                return;
            }

            popupDesc.textContent = pickBestDescription(details, movie);
            setPopupMetaChip(popupRating, getMovieRatingText(details));
            setPopupMetaChip(popupCountry, formatCountryWithFlag(details));
            setPopupMetaChip(popupGenre, getMovieMetaText(details));
            movie.description = pickBestDescription(details, movie);
            movie.genres = details.genres || movie.genres;
            movie.genresText = details.genresText || movie.genresText;
            movie.countries = details.countries || movie.countries;
            movie.countriesText = details.countriesText || movie.countriesText;
            movie.ratingKinopoisk = details.ratingKinopoisk ?? movie.ratingKinopoisk;
            movie.ratingImdb = details.ratingImdb ?? movie.ratingImdb;
            movie.ratingLabel = details.ratingLabel || movie.ratingLabel;
            movie.rating = details.rating ?? movie.rating;
            movie.ratingAgeLimits = details.ratingAgeLimits || movie.ratingAgeLimits;
            movie.poster = details.poster || movie.poster;
            movie.posterFull = details.posterFull || movie.posterFull;
            movie.filmLength = details.filmLength ?? movie.filmLength;
            popupPoster.style.backgroundImage = `url('${movie.posterFull || movie.poster}')`;
            setPopupMetaChip(popupCountry, formatCountryWithFlag(movie));
            setPopupMetaChip(popupGenre, getMovieMetaText(movie));
            setPopupMetaChip(popupDuration, formatMovieDuration(movie.filmLength));

            // Поля доступности и обновление кнопки «Смотреть».
            movie.productionStatus = details.productionStatus || movie.productionStatus;
            movie.completed = typeof details.completed === 'boolean' ? details.completed : movie.completed;
            movie.isTicketsAvailable =
                typeof details.isTicketsAvailable === 'boolean' ? details.isTicketsAvailable : movie.isTicketsAvailable;
            movie.kinopoiskHDId = details.kinopoiskHDId ?? movie.kinopoiskHDId;
            setupPopupWatchButton(movie);
        }
    }
}

function closePopup() {
    const popup = $('popup');
    if (popup) {
        popup.style.transition = '';
        popup.style.transform = '';
    }
    popupOverlay.style.opacity = '';
    popupOverlay.classList.remove('active');
    document.body.style.overflow = '';
    applyPopupActionButtons(null);
    hidePopupTrailerButton();
    hidePopupWatchButton();
    closeTrailerPlayer();
    currentPopupContext = { movie: null, status: null };
}

function handlePopupStatusActionClick(button) {
    if (!button || !currentPopupContext.movie || !currentPopupContext.status) return;
    const targetStatus = (button.dataset.targetStatus || '').trim();
    if (!targetStatus) return;

    setMovieStatus(currentPopupContext.movie, targetStatus);
    currentPopupContext.status = targetStatus;
    applyPopupActionButtons(currentPopupContext.status);
}

/**
 * Вернуть пропущенный фильм обратно в общую подборку:
 * убираем его из «Пропущенных» и снимаем пометку «показан»,
 * чтобы он снова мог попасть в ленту и рекомендации.
 */
function restoreSkippedMovie(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    removeFromStatusList(movie.id, 'skipped');
    state.seenMovieIds.delete(movie.id);
    saveSeenMoviesCache();
    closePopup();
}

// ============================================================
// Поиск фильмов
// ============================================================

let searchDebounceTimer = null;
let searchRequestId = 0;
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 350;

function setSearchState({ hint = false, loader = false, empty = false, results = false }) {
    if (searchHint) searchHint.style.display = hint ? '' : 'none';
    if (searchLoader) searchLoader.style.display = loader ? '' : 'none';
    if (searchEmpty) searchEmpty.style.display = empty ? '' : 'none';
    if (searchResults) searchResults.style.display = results ? '' : 'none';
}

function updateSearchClearButton() {
    if (searchClearBtn) {
        searchClearBtn.style.display = (searchInput && searchInput.value.trim()) ? '' : 'none';
    }
}

// Прибиваем оверлей к видимой области (visualViewport учитывает клавиатуру).
// Так экран поиска/чата ведёт себя как нативное окно: не «прыгает» при показе
// клавиатуры, а сжимается ровно до её верхней границы, поле ввода остаётся видно.
const overlayViewportBindings = new WeakMap();

function bindOverlayViewport(overlay) {
    if (!overlay) return;
    if (overlayViewportBindings.has(overlay)) return;
    const vv = window.visualViewport;
    const apply = () => {
        const h = (vv && vv.height) ? vv.height : window.innerHeight;
        overlay.style.height = h + 'px';
        overlay.style.top = ((vv && vv.offsetTop) ? vv.offsetTop : 0) + 'px';
    };
    apply();
    const onResize = () => apply();
    if (vv) {
        vv.addEventListener('resize', onResize);
        vv.addEventListener('scroll', onResize);
    }
    window.addEventListener('resize', onResize);
    overlayViewportBindings.set(overlay, { onResize });
}

function unbindOverlayViewport(overlay) {
    if (!overlay) return;
    const binding = overlayViewportBindings.get(overlay);
    if (!binding) return;
    const vv = window.visualViewport;
    if (vv) {
        vv.removeEventListener('resize', binding.onResize);
        vv.removeEventListener('scroll', binding.onResize);
    }
    window.removeEventListener('resize', binding.onResize);
    overlay.style.height = '';
    overlay.style.top = '';
    overlayViewportBindings.delete(overlay);
}

function openSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    bindOverlayViewport(searchOverlay);
    userMenu.classList.remove('active');
    updateSearchClearButton();
    if (!searchInput || !searchInput.value.trim()) {
        setSearchState({ hint: true });
    }
    if (searchInput) setTimeout(() => searchInput.focus(), 60);
}

function closeSearch() {
    if (!searchOverlay) return;
    searchOverlay.classList.remove('active');
    unbindOverlayViewport(searchOverlay);
    if (!popupOverlay.classList.contains('active')) {
        document.body.style.overflow = '';
    }
}

function renderSearchResults(movies) {
    if (!searchResults) return;
    searchResults.innerHTML = '';
    movies.forEach((movie, i) => {
        const card = document.createElement('div');
        card.className = 'fav-card';
        card.style.animationDelay = `${Math.min(i, 12) * 0.04}s`;
        const ratingText = getMovieRatingText(movie);
        const poster = getCardPosterUrl(movie) || movie.poster || '';
        card.innerHTML = `
            <img src="${poster}" alt="${movie.title}" loading="lazy">
            <div class="fav-info">
                <div class="fav-title">${movie.title}</div>
                ${movie.year ? `<div class="fav-genres">${movie.year}</div>` : ''}
                ${ratingText ? `<div class="fav-rating">⭐ ${ratingText}</div>` : ''}
            </div>
        `;
        card.addEventListener('click', () => openPopup(movie, 'search'));
        searchResults.appendChild(card);
    });
    setSearchState({ results: true });
}

async function runSearch(rawQuery) {
    const query = (rawQuery || '').trim();
    if (query.length < SEARCH_MIN_CHARS) {
        if (searchResults) searchResults.innerHTML = '';
        setSearchState({ hint: true });
        return;
    }
    const requestId = ++searchRequestId;
    setSearchState({ loader: true });
    try {
        const url = `${BACKEND_API_BASE}/api/search?query=${encodeURIComponent(query)}&limit=30`;
        const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (requestId !== searchRequestId) return; // пришёл более свежий запрос
        if (!response.ok) throw new Error(`search HTTP ${response.status}`);
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const movies = items.map(normalizeMovie).filter((m) => Number.isFinite(m.id));
        if (requestId !== searchRequestId) return;
        if (movies.length === 0) {
            if (searchResults) searchResults.innerHTML = '';
            setSearchState({ empty: true });
        } else {
            renderSearchResults(movies);
        }
    } catch (err) {
        if (requestId !== searchRequestId) return;
        console.warn('Ошибка поиска:', err);
        if (searchResults) searchResults.innerHTML = '';
        setSearchState({ empty: true });
    }
}

function handleSearchInput() {
    updateSearchClearButton();
    const value = searchInput ? searchInput.value : '';
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (value.trim().length < SEARCH_MIN_CHARS) {
        if (searchResults) searchResults.innerHTML = '';
        setSearchState({ hint: true });
        return;
    }
    searchDebounceTimer = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
}

function clearSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    updateSearchClearButton();
    if (searchResults) searchResults.innerHTML = '';
    setSearchState({ hint: true });
}

// ============================================================
// ИИ-ассистент поиска фильмов
// ============================================================

let aiHistory = [];   // [{role:'user'|'assistant', content:str}]
let aiBusy = false;
const AI_GREETING = 'Привет! Я помогу найти фильм или сериал по описанию. Расскажите, что помните: сцену, сюжет, героев, диалог — что угодно.';

function scrollAIToBottom() {
    if (aiMessages) aiMessages.scrollTop = aiMessages.scrollHeight;
}

function renderAIBubble(role, text) {
    if (!aiMessages) return null;
    const div = document.createElement('div');
    div.className = 'ai-msg ' + (role === 'user' ? 'user' : 'assistant');
    div.textContent = text;
    aiMessages.appendChild(div);
    scrollAIToBottom();
    return div;
}

function showAITyping() {
    if (!aiMessages || $('ai-typing-indicator')) return;
    const t = document.createElement('div');
    t.className = 'ai-typing';
    t.id = 'ai-typing-indicator';
    t.innerHTML = '<span></span><span></span><span></span>';
    aiMessages.appendChild(t);
    scrollAIToBottom();
}

function hideAITyping() {
    const t = $('ai-typing-indicator');
    if (t) t.remove();
}

function renderAIMovies(movies) {
    if (!aiMessages) return;
    const wrap = document.createElement('div');
    wrap.className = 'ai-movies';
    movies.forEach((movie) => {
        const card = document.createElement('div');
        card.className = 'fav-card';
        const ratingText = getMovieRatingText(movie);
        const poster = getCardPosterUrl(movie) || movie.poster || '';
        card.innerHTML = `
            <img src="${poster}" alt="${movie.title}" loading="lazy">
            <div class="fav-info">
                <div class="fav-title">${movie.title}</div>
                ${movie.year ? `<div class="fav-genres">${movie.year}</div>` : ''}
                ${ratingText ? `<div class="fav-rating">⭐ ${ratingText}</div>` : ''}
            </div>
        `;
        card.addEventListener('click', () => openPopup(movie, 'search'));
        wrap.appendChild(card);
    });
    aiMessages.appendChild(wrap);
    scrollAIToBottom();
}

function autoGrowAIInput() {
    if (!aiInput) return;
    aiInput.style.height = 'auto';
    aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
}

function openAI() {
    if (!aiOverlay) return;
    aiOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    bindOverlayViewport(aiOverlay);
    userMenu.classList.remove('active');
    if (aiHistory.length === 0 && aiMessages && !aiMessages.children.length) {
        renderAIBubble('assistant', AI_GREETING);
    }
    setTimeout(() => aiInput && aiInput.focus(), 60);
}

function closeAI() {
    if (!aiOverlay) return;
    aiOverlay.classList.remove('active');
    unbindOverlayViewport(aiOverlay);
    if (!popupOverlay.classList.contains('active')) {
        document.body.style.overflow = '';
    }
}

async function sendAIMessage() {
    if (aiBusy || !aiInput) return;
    const text = (aiInput.value || '').trim();
    if (!text) return;
    aiInput.value = '';
    autoGrowAIInput();
    renderAIBubble('user', text);
    aiHistory.push({ role: 'user', content: text });
    aiBusy = true;
    if (aiSendBtn) aiSendBtn.disabled = true;
    showAITyping();
    try {
        // POST с телом — напрямую в бэкенд, минуя WebView-прокси (он не пересылает body).
        const response = await fetch(`${BACKEND_POST_BASE}/api/ai/assistant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
            body: JSON.stringify({ messages: aiHistory.slice(-12) })
        });
        hideAITyping();
        if (!response.ok) throw new Error(`ai HTTP ${response.status}`);
        const data = await response.json();
        if (data.enabled === false) {
            renderAIBubble('assistant', data.reply || 'ИИ-ассистент пока недоступен.');
            return;
        }
        const reply = (data.reply || '').trim();
        if (reply) {
            renderAIBubble('assistant', reply);
            aiHistory.push({ role: 'assistant', content: reply });
        }
        const movies = Array.isArray(data.movies)
            ? data.movies.map(normalizeMovie).filter((m) => Number.isFinite(m.id))
            : [];
        if (movies.length) renderAIMovies(movies);
        if (!reply && !movies.length) {
            renderAIBubble('assistant', 'Не удалось ничего найти. Попробуйте вспомнить ещё детали.');
        }
    } catch (err) {
        hideAITyping();
        console.warn('AI error:', err);
        renderAIBubble('assistant', 'Не получилось связаться с ИИ. Проверьте соединение и попробуйте снова.');
    } finally {
        aiBusy = false;
        if (aiSendBtn) aiSendBtn.disabled = false;
        if (aiInput) aiInput.focus();
    }
}

// ============================================================
// Навигация по табам
// ============================================================

function switchTab(tab) {
    state.currentTab = tab;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.querySelectorAll('#main-app .screen').forEach(screen => {
        screen.classList.remove('active');
    });

    $(`screen-${tab}`).classList.add('active');

    // При переключении на «Избранное» — загружаем из Firestore
    if (tab === 'favorites') {
        loadFavoritesFromFirestore();
    }
}

// ============================================================
// Обработка фильтров категорий
// ============================================================

function toggleCategory(categoryId) {
    if (categoryId === 'all') {
        state.selectedCategoryIds.clear();
    } else if (state.selectedCategoryIds.has(categoryId)) {
        state.selectedCategoryIds.delete(categoryId);
    } else {
        state.selectedCategoryIds.add(categoryId);
    }

    renderCategoryFilters();
    state.page = 1;
    loadMovies();
}

// ============================================================
// Кнопки Like/Dislike
// ============================================================

function handleButtonSwipe(action) {
    const topCard = cardStack.querySelector('.movie-card');
    if (!topCard) return;
    handleCardAction(action, topCard);
}

// ============================================================
// Toggle Password Visibility
// ============================================================

function setupPasswordToggles() {
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = $(btn.dataset.target);
            if (input.type === 'password') {
                input.type = 'text';
            } else {
                input.type = 'password';
            }
        });
    });
}

// ============================================================
// User Menu
// ============================================================

const CLEARABLE_STATUS_CONFIG = {
    watchlist: {
        title: '“Хочу посмотреть”',
        emptyMessage: 'Список “Хочу посмотреть” уже пуст.'
    },
    liked: {
        title: '“Понравилось”',
        emptyMessage: 'Список “Понравилось” уже пуст.'
    },
    watched: {
        title: '“Просмотренное”',
        emptyMessage: 'Список “Просмотренное” уже пуст.'
    }
};
let confirmModalResolver = null;

function resolveAppVersion() {
    const fallback = APP_RUNTIME_CONFIG.appVersion;
    try {
        if (window.AndroidAds && typeof window.AndroidAds.getAppVersion === 'function') {
            const fromAndroid = window.AndroidAds.getAppVersion();
            if (typeof fromAndroid === 'string' && fromAndroid.trim()) {
                return fromAndroid.trim();
            }
        }
    } catch (error) {
        console.warn('Cannot get app version from Android bridge:', error);
    }
    return fallback;
}

function syncProfileInfoToSettings() {
    if (!state.user) return;
    const displayName = resolveUserDisplayName(state.user);
    const email = state.user.email || '';
    const firstLetter = displayName.charAt(0).toUpperCase();

    userName.textContent = displayName;
    userEmail.textContent = email;
    userAvatar.textContent = firstLetter;

    if (settingsUserName) settingsUserName.textContent = displayName;
    if (settingsUserEmail) settingsUserEmail.textContent = email;
    if (settingsUserAvatar) settingsUserAvatar.textContent = firstLetter;
}

function toggleUserMenu() {
    userMenu.classList.toggle('active');
}

function closeUserMenu(e) {
    const userButton = $('btn-user');
    if (!userMenu.contains(e.target) && !(userButton && userButton.contains(e.target))) {
        userMenu.classList.remove('active');
    }
}

function openSettingsOverlay() {
    if (!settingsOverlay) return;
    syncProfileInfoToSettings();
    settingsOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSettingsOverlay() {
    if (!settingsOverlay) return;
    settingsOverlay.classList.remove('active');
    if (aboutModalOverlay) {
        aboutModalOverlay.classList.remove('active');
    }
    closeConfirmModalWithResult(false);
    if (!popupOverlay.classList.contains('active') && !countryPickerOverlay?.classList.contains('active')) {
        document.body.style.overflow = '';
    }
}

function openAboutModal() {
    if (!aboutModalOverlay) return;
    if (aboutVersion) {
        aboutVersion.textContent = resolveAppVersion();
    }
    aboutModalOverlay.classList.add('active');
}

function closeAboutModal() {
    if (!aboutModalOverlay) return;
    aboutModalOverlay.classList.remove('active');
}

function closeConfirmModalWithResult(result) {
    if (confirmModalOverlay) {
        confirmModalOverlay.classList.remove('active');
    }
    const resolver = confirmModalResolver;
    confirmModalResolver = null;
    if (typeof resolver === 'function') {
        resolver(Boolean(result));
    }
}

function openConfirmModal(options = {}) {
    const {
        title = 'Подтверждение',
        message = '',
        confirmText = 'Подтвердить',
        cancelText = 'Отмена',
        showCancel = true,
        danger = true
    } = options;

    if (!confirmModalOverlay || !confirmModalTitle || !confirmModalMessage || !confirmModalOk || !confirmModalCancel) {
        const fallback = window.confirm(message || title);
        return Promise.resolve(fallback);
    }

    if (confirmModalResolver) {
        closeConfirmModalWithResult(false);
    }

    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    confirmModalOk.textContent = confirmText;
    confirmModalCancel.textContent = cancelText;
    confirmModalCancel.style.display = showCancel ? '' : 'none';
    confirmModalOk.classList.toggle('danger', danger);

    confirmModalOverlay.classList.add('active');

    return new Promise((resolve) => {
        confirmModalResolver = resolve;
    });
}

function openExternalUrl(url) {
    if (!url) return;
    try {
        if (window.AndroidAds && typeof window.AndroidAds.openExternalUrl === 'function') {
            window.AndroidAds.openExternalUrl(url);
            return;
        }
    } catch (error) {
        console.warn('Android external URL bridge error:', error);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

// ============================================================
// ОБЪЯВЛЕНИЕ / УВЕДОМЛЕНИЕ ОБ ОБНОВЛЕНИИ
// Текст и условия показа управляются с сервера через /api/config.
// Чтобы показать баннер: в app_config.json выставить announcement.enabled = true
// и задать уникальный announcement.id. Смена id заново показывает баннер тем,
// кто ранее его закрыл.
// ============================================================

const ANNOUNCEMENT_DISMISS_KEY = 'feelfilm_dismissed_announcement_id';

function getDismissedAnnouncementId() {
    try {
        return localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY) || '';
    } catch (error) {
        return '';
    }
}

function setDismissedAnnouncementId(id) {
    try {
        localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, id || '');
    } catch (error) {
        /* localStorage может быть недоступен — не критично */
    }
}

function hideAnnouncement() {
    if (appAnnouncement) {
        appAnnouncement.classList.remove('active');
    }
}

function renderAnnouncement(announcement) {
    if (!appAnnouncement || !announcement || typeof announcement !== 'object') return;
    if (announcement.enabled !== true) return;

    const id = (announcement.id || '').toString().trim();
    const title = (announcement.title || '').toString().trim();
    const message = (announcement.message || '').toString().trim();
    if (!title && !message) return;

    // Уже закрыто этим пользователем — не показываем повторно, пока не сменится id.
    if (id && getDismissedAnnouncementId() === id) return;

    if (appAnnouncementTitle) appAnnouncementTitle.textContent = title;
    if (appAnnouncementText) appAnnouncementText.textContent = message;

    const actionUrl = (announcement.action_url || '').toString().trim();
    const actionText = (announcement.action_text || '').toString().trim();
    if (appAnnouncementAction) {
        if (actionUrl && actionText) {
            appAnnouncementAction.textContent = actionText;
            appAnnouncementAction.onclick = () => openExternalUrl(actionUrl);
        } else {
            appAnnouncementAction.textContent = '';
            appAnnouncementAction.onclick = null;
        }
    }

    const dismissible = announcement.dismissible !== false;
    if (appAnnouncementClose) {
        appAnnouncementClose.style.display = dismissible ? '' : 'none';
        appAnnouncementClose.onclick = () => {
            if (id) setDismissedAnnouncementId(id);
            hideAnnouncement();
        };
    }

    appAnnouncement.classList.add('active');
}

async function loadRemoteAnnouncement() {
    try {
        const response = await fetch(`${BACKEND_API_BASE}/api/config`, {
            method: 'GET',
            cache: 'no-store',
        });
        if (!response.ok) return;
        const config = await response.json();
        renderAnnouncement(config?.announcement);
    } catch (error) {
        console.warn('Не удалось загрузить объявление об обновлении:', error);
    }
}

function openContactEmail() {
    const email = APP_RUNTIME_CONFIG.contactEmail;
    if (!email) return;
    try {
        if (window.AndroidAds && typeof window.AndroidAds.composeEmail === 'function') {
            window.AndroidAds.composeEmail(
                APP_RUNTIME_CONFIG.contactEmail,
                APP_RUNTIME_CONFIG.contactSubject,
                ''
            );
            return;
        }
    } catch (error) {
        console.warn('Android email bridge error:', error);
    }
    const subject = encodeURIComponent(APP_RUNTIME_CONFIG.contactSubject || '');
    window.location.href = `mailto:${email}?subject=${subject}`;
}

function getStatusIdsForClear(status) {
    if (status === 'watchlist') return [...state.favoriteOrderIds];
    if (status === 'liked') return [...state.likedOrderIds];
    if (status === 'watched') return [...state.watchedOrderIds];
    return [];
}

function clearStatusListLocally(status, idsToClear) {
    if (status === 'watchlist') {
        state.favoriteIds.clear();
        state.favoriteOrderIds = [];
        state.favoriteDetailsById.clear();
        state.favoritesVisibleCount = FAVORITES_PAGE_SIZE;
    } else if (status === 'liked') {
        state.likedIds.clear();
        state.likedOrderIds = [];
        state.likedDetailsById.clear();
        state.likedVisibleCount = FAVORITES_PAGE_SIZE;
        idsToClear.forEach((id) => state.interactions.likedMovieIds.delete(id));
    } else if (status === 'watched') {
        state.watchedIds.clear();
        state.watchedOrderIds = [];
        state.watchedDetailsById.clear();
        state.watchedVisibleCount = FAVORITES_PAGE_SIZE;
    } else {
        return;
    }

    syncFavoritesArray();
    syncLikedArray();
    syncWatchedArray();
    saveAllStatusCaches();
    applyFavoritesState();
}

async function clearStatusListInCloud(status) {
    if (!state.user) return;
    let payload = null;

    if (status === 'watchlist') {
        payload = { watchlist: [], favorites: [] };
    } else if (status === 'liked') {
        payload = { liked: [] };
    } else if (status === 'watched') {
        payload = { watched: [] };
    }

    if (!payload) return;
    try {
        await setDoc(getUserDocRef(), payload, { merge: true });
    } catch (err) {
        console.error('Failed to clear list in Firestore:', err);
    }
}

async function clearStatusListWithConfirmation(status) {
    const meta = CLEARABLE_STATUS_CONFIG[status];
    if (!meta) return;

    const idsToClear = getStatusIdsForClear(status);
    if (idsToClear.length === 0) {
        await openConfirmModal({
            title: 'Информация',
            message: meta.emptyMessage,
            confirmText: 'Понятно',
            showCancel: false,
            danger: false
        });
        return;
    }

    const confirmed = await openConfirmModal({
        title: 'Подтвердите очистку',
        message: `Очистить список ${meta.title}?\nЭто действие нельзя отменить.`,
        confirmText: 'Очистить',
        cancelText: 'Отмена',
        showCancel: true,
        danger: true
    });
    if (!confirmed) return;

    clearStatusListLocally(status, idsToClear);
    void clearStatusListInCloud(status);
}

async function clearSkippedInCloud() {
    if (!state.user) return;
    try {
        await setDoc(getUserDocRef(), { skipped: [], disliked: [] }, { merge: true });
    } catch (err) {
        console.error('Не удалось сбросить историю подбора в Firestore:', err);
    }
}

/**
 * Сброс подбора: очищает историю свайпов (пропущенные), историю показов
 * и сигналы персонализации, затем формирует ленту заново.
 * Сохранённые списки «Избранного» (Хочу посмотреть / Понравилось / Просмотрено)
 * не затрагиваются — у них есть отдельные кнопки очистки.
 */
function performDiscoveryReset() {
    const hadSkipped = state.skippedOrderIds.length > 0 || state.skippedIds.size > 0;

    // Пропущенные (свайпы влево).
    state.skippedIds.clear();
    state.skippedOrderIds = [];
    state.skippedDetailsById.clear();
    state.skippedDetailsInFlight.clear();
    state.skippedVisibleCount = FAVORITES_PAGE_SIZE;
    syncSkippedArray();

    // История показов и сигналы персонализации.
    state.seenMovieIds = new Set();
    saveSeenMoviesCache();
    state.interactions = createEmptyInteractionsState();
    saveInteractionsCache();

    // Пересобираем предпочтения по оставшимся спискам и чистим кеши.
    saveSkippedCache();
    clearDiscoverFeedCache();

    // Текущая лента сбрасывается и грузится заново, как при первом запуске.
    state.movies = [];
    state.currentIndex = 0;
    state.page = 1;
    state.isPrefetching = false;
    if (cardStack) cardStack.innerHTML = '';

    applyFavoritesState();

    if (hadSkipped) {
        void clearSkippedInCloud();
    }

    switchTab('discover');
    loadMovies();
}

async function resetDiscoveryWithConfirmation() {
    const confirmed = await openConfirmModal({
        title: 'Сбросить подбор',
        message: 'Вы уверены, что хотите сбросить подбор? История ваших свайпов будет очищена.',
        confirmText: 'Сбросить',
        cancelText: 'Отмена',
        showCancel: true,
        danger: true
    });
    if (!confirmed) return;

    closeSettingsOverlay();
    performDiscoveryReset();
}

function setupGestureNavigation() {
    const favoritesScreen = $('screen-favorites');
    const popup = $('popup');

    if (favoritesScreen) {
        let startX = 0;
        let startY = 0;
        let tracking = false;

        favoritesScreen.addEventListener('touchstart', (e) => {
            const t = e.touches && e.touches[0];
            if (!t) return;
            tracking = true;
            startX = t.clientX;
            startY = t.clientY;
        }, { passive: true });

        favoritesScreen.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            if (state.currentTab !== 'favorites' || popupOverlay.classList.contains('active')) return;
            const t = e.changedTouches && e.changedTouches[0];
            if (!t) return;

            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            const isRightSwipe = dx > 90 && Math.abs(dy) < 70 && Math.abs(dx) > Math.abs(dy) * 1.2;
            if (isRightSwipe) {
                switchTab('discover');
            }
        }, { passive: true });
    }

    if (popup) {
        let startX = 0;
        let startY = 0;
        let tracking = false;
        let dragOffsetY = 0;

        popup.addEventListener('touchstart', (e) => {
            if (!popupOverlay.classList.contains('active')) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            tracking = true;
            dragOffsetY = 0;
            startX = t.clientX;
            startY = t.clientY;
        }, { passive: true });

        popup.addEventListener('touchmove', (e) => {
            if (!tracking || !popupOverlay.classList.contains('active')) return;
            const t = e.touches && e.touches[0];
            if (!t) return;

            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            const canDragDown = popup.scrollTop <= 0 && dy > 0 && Math.abs(dy) > Math.abs(dx);
            if (!canDragDown) return;

            dragOffsetY = Math.min(dy, 260);
            popup.style.transition = 'none';
            popup.style.transform = `translateY(${dragOffsetY}px)`;
            popupOverlay.style.opacity = `${Math.max(0.55, 1 - dragOffsetY / 380)}`;
        }, { passive: true });

        popup.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            if (!popupOverlay.classList.contains('active')) return;
            const t = e.changedTouches && e.changedTouches[0];
            if (!t) return;

            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            const canCloseBySwipeDown = popup.scrollTop <= 0;
            const isDownSwipe = dy > 90 && Math.abs(dx) < 70 && Math.abs(dy) > Math.abs(dx) * 1.2;

            if (canCloseBySwipeDown && isDownSwipe) {
                closePopup();
                return;
            }

            popup.style.transition = '';
            popup.style.transform = '';
            popupOverlay.style.opacity = '';
            dragOffsetY = 0;
        }, { passive: true });

        popup.addEventListener('touchcancel', () => {
            tracking = false;
            popup.style.transition = '';
            popup.style.transform = '';
            popupOverlay.style.opacity = '';
            dragOffsetY = 0;
        }, { passive: true });
    }
}

// ============================================================
// Инициализация
// ============================================================

function init() {
    // --- Auth forms ---
    formLogin.addEventListener('submit', handleLogin);
    formRegister.addEventListener('submit', handleRegister);

    // Переключение Login <-> Register
    $('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        formLogin.style.display = 'none';
        formRegister.style.display = 'block';
        loginError.textContent = '';
    });

    $('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        formRegister.style.display = 'none';
        formLogin.style.display = 'block';
        registerError.textContent = '';
    });

    setupPasswordToggles();

    // --- User Menu ---
    $('btn-user').addEventListener('click', toggleUserMenu);

    // --- Поиск фильмов ---
    $('btn-search').addEventListener('click', openSearch);
    if ($('btn-search-back')) $('btn-search-back').addEventListener('click', closeSearch);
    if (searchClearBtn) searchClearBtn.addEventListener('click', clearSearchInput);
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
                runSearch(searchInput.value);
                searchInput.blur();
            } else if (e.key === 'Escape') {
                closeSearch();
            }
        });
    }

    // --- ИИ-ассистент ---
    $('btn-ai').addEventListener('click', openAI);
    if ($('btn-ai-back')) $('btn-ai-back').addEventListener('click', closeAI);
    if (aiSendBtn) aiSendBtn.addEventListener('click', sendAIMessage);
    if (aiInput) {
        aiInput.addEventListener('input', autoGrowAIInput);
        aiInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAIMessage();
            } else if (e.key === 'Escape') {
                closeAI();
            }
        });
    }

    $('btn-open-settings').addEventListener('click', () => {
        userMenu.classList.remove('active');
        openSettingsOverlay();
    });
    $('btn-logout').addEventListener('click', () => {
        userMenu.classList.remove('active');
        handleLogout();
    });
    document.addEventListener('click', closeUserMenu);

    if (aboutVersion) {
        aboutVersion.textContent = resolveAppVersion();
    }
    $('btn-settings-back').addEventListener('click', closeSettingsOverlay);
    $('btn-about-app').addEventListener('click', openAboutModal);
    $('btn-about-close').addEventListener('click', closeAboutModal);
    $('btn-open-privacy').addEventListener('click', () => openExternalUrl(APP_RUNTIME_CONFIG.privacyPolicyUrl));
    $('btn-contact-us').addEventListener('click', openContactEmail);
    $('btn-clear-watchlist').addEventListener('click', () => void clearStatusListWithConfirmation('watchlist'));
    $('btn-clear-liked').addEventListener('click', () => void clearStatusListWithConfirmation('liked'));
    $('btn-clear-watched').addEventListener('click', () => void clearStatusListWithConfirmation('watched'));
    $('btn-reset-discovery').addEventListener('click', () => void resetDiscoveryWithConfirmation());

    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (e) => {
            if (e.target === settingsOverlay) closeSettingsOverlay();
        });
    }
    if (aboutModalOverlay) {
        aboutModalOverlay.addEventListener('click', (e) => {
            if (e.target === aboutModalOverlay) closeAboutModal();
        });
    }
    if (confirmModalCancel) {
        confirmModalCancel.addEventListener('click', () => closeConfirmModalWithResult(false));
    }
    if (confirmModalOk) {
        confirmModalOk.addEventListener('click', () => closeConfirmModalWithResult(true));
    }
    if (confirmModalOverlay) {
        confirmModalOverlay.addEventListener('click', (e) => {
            if (e.target === confirmModalOverlay) {
                closeConfirmModalWithResult(false);
            }
        });
    }

    // --- Tabs ---
    $('tab-discover').addEventListener('click', () => switchTab('discover'));
    $('tab-favorites').addEventListener('click', () => switchTab('favorites'));

    // --- Категории ---
    renderCategoryFilters();

    // --- Кнопки свайпа ---
    $('btn-like').addEventListener('click', () => handleButtonSwipe('liked'));
    $('btn-dislike').addEventListener('click', () => handleButtonSwipe('skipped'));
    $('btn-watchlist').addEventListener('click', () => handleButtonSwipe('watchlist'));
    $('btn-watched').addEventListener('click', () => handleButtonSwipe('watched'));

    // --- Кнопка «Загрузить ещё» ---
    $('btn-reset').addEventListener('click', () => {
        loadMovies();
    });

    // --- Кнопка «Попробовать снова» ---
    $('btn-retry').addEventListener('click', () => loadMovies());

    // --- Popup ---
    $('popup-close').addEventListener('click', closePopup);
    $('popup-overlay').addEventListener('click', (e) => {
        if (e.target === popupOverlay) closePopup();
    });
    $('popup-delete').addEventListener('click', () => {
        if (currentPopupContext.movie && currentPopupContext.status) {
            removeFromStatusList(currentPopupContext.movie.id, currentPopupContext.status);
            closePopup();
        }
    });
    $('popup-restore').addEventListener('click', () => {
        if (currentPopupContext.movie && currentPopupContext.status === 'skipped') {
            restoreSkippedMovie(currentPopupContext.movie);
        }
    });
    if (popupToggleWatchlist) {
        popupToggleWatchlist.addEventListener('click', () => handlePopupStatusActionClick(popupToggleWatchlist));
    }
    if (popupToggleWatched) {
        popupToggleWatched.addEventListener('click', () => handlePopupStatusActionClick(popupToggleWatched));
    }

    if (trailerClose) {
        trailerClose.addEventListener('click', closeTrailerPlayer);
    }
    if (trailerOverlay) {
        trailerOverlay.addEventListener('click', (e) => {
            if (e.target === trailerOverlay) closeTrailerPlayer();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && trailerOverlay?.classList.contains('active')) {
            closeTrailerPlayer();
        }
    });

    if (countryPickerClose) {
        countryPickerClose.addEventListener('click', closeCountryPicker);
    }
    if (countryPickerOverlay) {
        countryPickerOverlay.addEventListener('click', (e) => {
            if (e.target === countryPickerOverlay) closeCountryPicker();
        });
    }

    setupGestureNavigation();

    // --- Firebase Auth Observer ---
    // Следит за входом/выходом и автоматически переключает экраны
    setupAuthObserver();

    // --- Объявление об обновлении (управляется с сервера) ---
    void loadRemoteAnnouncement();
}

// Запуск
document.addEventListener('DOMContentLoaded', init);
