/* ============================================================
   FeelFilm вЂ” Р›РѕРіРёРєР° РїСЂРёР»РѕР¶РµРЅРёСЏ
   Firebase Auth + Firestore + Kinopoisk API
   ============================================================ */

// =====================================================
// Firebase SDK (v10+ modular, С‡РµСЂРµР· CDN ESM)
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
// вљ пёЏ  FIREBASE CONFIG вЂ” Р’РЎРўРђР’Р¬ РЎР’РћР Р”РђРќРќР«Р•  вљ пёЏ
// РџРѕР»СѓС‡РёС‚СЊ config РјРѕР¶РЅРѕ РІ Firebase Console:
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
const BACKEND_API_BASE =
    window.FEELFILMS_BACKEND_API_BASE ||
    localStorage.getItem('feelfilms_backend_api_base') ||
    'https://feelfilms.onrender.com';

// --- РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ Firebase ---
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Auth persistence fallback to inMemory:', err);
    return setPersistence(auth, inMemoryPersistence);
});

// --- РњР°РїРїРёРЅРі РЅР°СЃС‚СЂРѕРµРЅРёР№ РЅР° Р¶Р°РЅСЂС‹ РљРёРЅРѕРџРѕРёСЃРєР° ---
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

// --- РњР°РїРїРёРЅРі РѕС€РёР±РѕРє Firebase РЅР° СЂСѓСЃСЃРєРёР№ ---
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

// --- РЎРѕСЃС‚РѕСЏРЅРёРµ РїСЂРёР»РѕР¶РµРЅРёСЏ ---
const state = {
    user: null,          // РўРµРєСѓС‰РёР№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ Firebase
    movies: [],          // РўРµРєСѓС‰РёР№ СЃС‚РµРє РєР°СЂС‚РѕС‡РµРє
    currentIndex: 0,     // РРЅРґРµРєСЃ С‚РµРєСѓС‰РµР№ РІРµСЂС…РЅРµР№ РєР°СЂС‚РѕС‡РєРё
    favorites: [],       // РР·Р±СЂР°РЅРЅС‹Рµ СЃ Р·Р°РіСЂСѓР¶РµРЅРЅС‹РјРё РґРµС‚Р°Р»СЏРјРё
    favoriteIds: new Set(), // Р’СЃРµ ID РёР·Р±СЂР°РЅРЅС‹С…
    favoriteOrderIds: [], // РџРѕСЂСЏРґРѕРє ID РІ РёР·Р±СЂР°РЅРЅРѕРј
    favoriteDetailsById: new Map(), // Р”РµС‚Р°Р»Рё С„РёР»СЊРјРѕРІ РїРѕ ID
    favoritesVisibleCount: 12,
    favoriteDetailsInFlight: new Set(),
    seenMovieIds: new Set(), // РџСЂРѕСЃРјРѕС‚СЂРµРЅРЅС‹Рµ (РЅРµ РїРѕРєР°Р·С‹РІР°С‚СЊ РїРѕРІС‚РѕСЂРЅРѕ)
    allCategories: CATEGORY_DEFINITIONS,
    selectedCategoryIds: new Set(),
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
    page: 1,             // РўРµРєСѓС‰Р°СЏ СЃС‚СЂР°РЅРёС†Р° API
    isLoading: false,
    currentTab: 'discover'
};

const FAVORITES_CACHE_PREFIX = 'feelfilms_favorites_cache_v2_';
const FAVORITES_PAGE_SIZE = 12;
const SEEN_MOVIES_CACHE_PREFIX = 'feelfilms_seen_movies_v1_';
const SEEN_MOVIES_MAX = 2000;
const FIRESTORE_TIMEOUT_MS = 8000;
const INTERACTIONS_CACHE_PREFIX = 'feelfilms_interactions_v1_';
const RECENT_SHOWN_MAX = 120;
const RECENT_SHOWN_PENALTY_WINDOW = 40;
const MAX_OPEN_COUNT_TRACK = 500;

function getFavoritesCacheKey() {
    return state.user ? `${FAVORITES_CACHE_PREFIX}${state.user.uid}` : null;
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
        console.warn('РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ РєРµС€ РёР·Р±СЂР°РЅРЅРѕРіРѕ:', err);
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
        console.warn('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РєРµС€ РёР·Р±СЂР°РЅРЅРѕРіРѕ:', err);
    }
}

function syncFavoritesArray() {
    state.favorites = state.favoriteOrderIds
        .map((id) => state.favoriteDetailsById.get(id))
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

function upsertFavoriteDetail(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    state.favoriteDetailsById.set(movie.id, movie);
    syncFavoritesArray();
}

function applyFavoritesState() {
    syncFavoritesArray();
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
        console.warn('РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ РєРµС€ РїСЂРѕСЃРјРѕС‚СЂРµРЅРЅС‹С… С„РёР»СЊРјРѕРІ:', err);
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
        console.warn('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РєРµС€ РїСЂРѕСЃРјРѕС‚СЂРµРЅРЅС‹С… С„РёР»СЊРјРѕРІ:', err);
    }
}

function markMovieAsSeen(movieId) {
    if (!Number.isFinite(movieId)) return;
    state.seenMovieIds.add(movieId);
    saveSeenMoviesCache();
}

function filterUnseenMovies(movies) {
    return movies.filter((movie) => !state.seenMovieIds.has(movie.id));
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
// DOM-СЌР»РµРјРµРЅС‚С‹
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
const favGrid = $('favorites-grid');
const favLoader = $('fav-loader');
const emptyFavs = $('empty-favorites');
const popupOverlay = $('popup-overlay');
const popupPoster = $('popup-poster');
const popupTitle = $('popup-title');
const popupYear = $('popup-year');
const popupRating = $('popup-rating');
const popupGenre = $('popup-genre');
const popupDesc = $('popup-description');
const userMenu = $('user-menu');
const userName = $('user-name');
const userEmail = $('user-email');
const userAvatar = $('user-avatar');
const moodFilters = $('mood-filters');

// ============================================================
// FIREBASE AUTH вЂ” Р РµРіРёСЃС‚СЂР°С†РёСЏ Рё Р’С…РѕРґ
// ============================================================

/**
 * Р РµРіРёСЃС‚СЂР°С†РёСЏ РЅРѕРІРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (Email + Password)
 */
async function handleRegister(e) {
    e.preventDefault();
    const name = $('register-name').value.trim();
    const email = $('register-email').value.trim();
    const password = $('register-password').value;

    registerError.textContent = '';
    setAuthLoading('btn-register', true);

    try {
        // РЎРѕР·РґР°С‘Рј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РІ Firebase Auth
        const cred = await createUserWithEmailAndPassword(auth, email, password);

        // РћР±РЅРѕРІР»СЏРµРј РїСЂРѕС„РёР»СЊ вЂ” СЃРѕС…СЂР°РЅСЏРµРј РёРјСЏ
        await updateProfile(cred.user, { displayName: name });

        console.log('вњ… Р РµРіРёСЃС‚СЂР°С†РёСЏ СѓСЃРїРµС€РЅР°:', cred.user.email);
        // onAuthStateChanged Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРµСЂРµРєР»СЋС‡РёС‚ РЅР° РѕСЃРЅРѕРІРЅРѕР№ СЌРєСЂР°РЅ
    } catch (err) {
        console.error('вќЊ РћС€РёР±РєР° СЂРµРіРёСЃС‚СЂР°С†РёРё:', err);
        registerError.textContent = formatAuthError(err);
    } finally {
        setAuthLoading('btn-register', false);
    }
}

/**
 * Р’С…РѕРґ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (Email + Password)
 */
async function handleLogin(e) {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;

    loginError.textContent = '';
    setAuthLoading('btn-login', true);

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log('вњ… Р’С…РѕРґ СѓСЃРїРµС€РµРЅ:', cred.user.email);
        // onAuthStateChanged Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРµСЂРµРєР»СЋС‡РёС‚ РЅР° РѕСЃРЅРѕРІРЅРѕР№ СЌРєСЂР°РЅ
    } catch (err) {
        console.error('вќЊ РћС€РёР±РєР° РІС…РѕРґР°:', err);
        loginError.textContent = formatAuthError(err);
    } finally {
        setAuthLoading('btn-login', false);
    }
}

/**
 * Р’С‹С…РѕРґ РёР· Р°РєРєР°СѓРЅС‚Р°
 */
async function handleLogout() {
    try {
        await signOut(auth);
        console.log('вњ… Р’С‹С…РѕРґ РёР· Р°РєРєР°СѓРЅС‚Р°');
        showAuthScreen();
        loginError.textContent = '';
        registerError.textContent = '';
    } catch (err) {
        console.error('вќЊ РћС€РёР±РєР° РІС‹С…РѕРґР°:', err);
        showAuthScreen();
        loginError.textContent = `\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u044b\u0439\u0442\u0438 \u0438\u0437 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 (${err?.code || 'auth/logout-failed'})`;
    }
}

/**
 * РџРµСЂРµРєР»СЋС‡РµРЅРёРµ loading-СЃРѕСЃС‚РѕСЏРЅРёСЏ РєРЅРѕРїРєРё
 */
function setAuthLoading(btnId, isLoading) {
    const btn = $(btnId);
    btn.disabled = isLoading;
    btn.querySelector('.btn-text').style.display = isLoading ? 'none' : '';
    btn.querySelector('.btn-loader').style.display = isLoading ? 'inline-block' : 'none';
}

/**
 * РќР°Р±Р»СЋРґР°С‚РµР»СЊ Р·Р° СЃРѕСЃС‚РѕСЏРЅРёРµРј Р°РІС‚РѕСЂРёР·Р°С†РёРё.
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїСЂРё РІС…РѕРґРµ/РІС‹С…РѕРґРµ.
 */
function setupAuthObserver() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // вњ… РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РІРѕС€С‘Р»
            const isNewUserSession = state.user?.uid !== user.uid;
            state.user = user;
            showMainApp(user, isNewUserSession);
        } else {
            // вќЊ РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РІС‹С€РµР»
            state.user = null;
            showAuthScreen();
        }
    });
}

/**
 * РџРѕРєР°Р·Р°С‚СЊ РіР»Р°РІРЅРѕРµ РїСЂРёР»РѕР¶РµРЅРёРµ РїРѕСЃР»Рµ РІС…РѕРґР°
 */
function showMainApp(user, forceReload = false) {
    screenAuth.classList.remove('active');
    screenAuth.style.display = 'none';
    mainApp.style.display = 'flex';

    // РћР±РЅРѕРІР»СЏРµРј UI РїСЂРѕС„РёР»СЏ
    const displayName = user.displayName || '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c';
    userName.textContent = displayName;
    userEmail.textContent = user.email;
    userAvatar.textContent = displayName.charAt(0).toUpperCase();
    state.seenMovieIds = loadSeenMoviesCache();
    state.interactions = loadInteractionsCache();

    // РР·Р±РµРіР°РµРј РІРёР·СѓР°Р»СЊРЅРѕРіРѕ "РїРµСЂРµР·Р°РїСѓСЃРєР°" СЌРєСЂР°РЅР° РїСЂРё РїРѕРІС‚РѕСЂРЅРѕРј auth-СЃРѕР±С‹С‚РёРё
    if (forceReload || state.movies.length === 0) {
        loadMovies();
    }
}

/**
 * РџРѕРєР°Р·Р°С‚СЊ СЌРєСЂР°РЅ Р°РІС‚РѕСЂРёР·Р°С†РёРё
 */
function showAuthScreen() {
    mainApp.style.display = 'none';
    screenAuth.style.display = 'flex';
    screenAuth.classList.add('active');

    // РћС‡РёС‰Р°РµРј СЃРѕСЃС‚РѕСЏРЅРёРµ
    state.favorites = [];
    state.favoriteIds.clear();
    state.favoriteOrderIds = [];
    state.favoriteDetailsById.clear();
    state.favoriteDetailsInFlight.clear();
    state.favoritesVisibleCount = FAVORITES_PAGE_SIZE;
    state.preferences = {
        categoryWeights: {},
        typeWeights: {},
        countryWeights: {},
        keywordWeights: {},
        preferredYear: null,
        preferredRating: null
    };
    state.selectedCategoryIds.clear();
    state.seenMovieIds = new Set();
    state.interactions = createEmptyInteractionsState();
    state.lastShownMovieId = null;
    state.movies = [];
    cardStack.innerHTML = '';
    favGrid.innerHTML = '';
    renderCategoryFilters();
    updateFavBadge();
}

// ============================================================
// FIRESTORE вЂ” РР·Р±СЂР°РЅРЅРѕРµ РІ РѕР±Р»Р°РєРµ
// ============================================================

/**
 * РџСѓС‚СЊ Рє РєРѕР»Р»РµРєС†РёРё favorites С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ:
 * users/{user_id}/favorites/{film_id}
 */
function getUserDocRef() {
    return doc(db, 'users', state.user.uid);
}

function toFavoriteMovieFromDetails(id, details) {
    const genres = normalizeGenres(details.genres || '');
    const countries = normalizeCountries(details.countries || '');
    return {
        id,
        title: details.title || `Film #${id}`,
        poster: details.poster || '',
        posterFull: details.posterFull || details.poster || '',
        rating: details.rating || null,
        year: details.year || '',
        description: details.description || '',
        genresText: details.genres || '',
        countriesText: details.countries || '',
        countries,
        genres,
        contentType: inferContentType(details.type || 'FILM', genres)
    };
}

async function readFavoriteIdsFromCloud() {
    const snapshot = await getDoc(getUserDocRef());
    if (!snapshot.exists()) return [];
    const favorites = snapshot.data()?.favorites;
    if (!Array.isArray(favorites)) return [];
    return favorites.map((id) => Number(id)).filter((id) => Number.isFinite(id));
}

async function fetchFavoriteDetailsBatch(ids) {
    const detailsList = await Promise.all(ids.map(async (id) => {
        const details = await fetchMovieDetails(id);
        if (!details) return null;
        return toFavoriteMovieFromDetails(id, details);
    }));
    return detailsList.filter(Boolean);
}

async function ensureFavoriteDetailsForVisible() {
    const visibleIds = state.favoriteOrderIds.slice(0, state.favoritesVisibleCount);
    const missingIds = visibleIds.filter(
        (id) => !state.favoriteDetailsById.has(id) && !state.favoriteDetailsInFlight.has(id)
    );

    if (missingIds.length === 0) return;

    missingIds.forEach((id) => state.favoriteDetailsInFlight.add(id));
    try {
        const movies = await fetchFavoriteDetailsBatch(missingIds);
        movies.forEach((movie) => upsertFavoriteDetail(movie));
        applyFavoritesState();
        saveFavoritesCache();
    } finally {
        missingIds.forEach((id) => state.favoriteDetailsInFlight.delete(id));
    }
}

function renderFavoritesSkeleton(count = FAVORITES_PAGE_SIZE) {
    favGrid.innerHTML = '';
    emptyFavs.style.display = 'none';
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
        favGrid.appendChild(card);
    }
}

async function saveToFirestore(movie) {
    if (!state.user) return;
    const movieId = Number(movie?.id);
    if (!Number.isFinite(movieId)) {
        console.warn('Skip Firestore save: invalid movie id', movie?.id);
        return;
    }
    try {
        await setDoc(getUserDocRef(), {
            favorites: arrayUnion(movieId)
        }, { merge: true });
        console.log('Favorites synced (+):', movieId);
    } catch (err) {
        console.error('Firestore write failed:', err);
    }
}

async function deleteFromFirestore(movieId) {
    if (!state.user) return;
    const normalizedId = Number(movieId);
    if (!Number.isFinite(normalizedId)) {
        console.warn('Skip Firestore delete: invalid movie id', movieId);
        return;
    }
    try {
        await setDoc(getUserDocRef(), {
            favorites: arrayRemove(normalizedId)
        }, { merge: true });
        console.log('Favorites synced (-):', normalizedId);
    } catch (err) {
        console.error('Firestore delete failed:', err);
    }
}

async function loadFavoritesFromFirestore() {
    if (!state.user) return;

    const cached = loadFavoritesCache();
    applyFavoritesIds(cached.ids);
    applyFavoriteDetails(cached.details);
    state.favoritesVisibleCount = FAVORITES_PAGE_SIZE;
    favLoader.style.display = 'none';

    if (state.favoriteOrderIds.length > 0) {
        applyFavoritesState();
        ensureFavoriteDetailsForVisible();
    } else {
        renderFavoritesSkeleton();
    }

    try {
        const ids = await Promise.race([
            readFavoriteIdsFromCloud(),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Firestore timeout')), FIRESTORE_TIMEOUT_MS);
            })
        ]);

        applyFavoritesIds(ids);
        const pruned = new Map();
        ids.forEach((id) => {
            const movie = state.favoriteDetailsById.get(id);
            if (movie) pruned.set(id, movie);
        });
        state.favoriteDetailsById = pruned;

        if (ids.length === 0) {
            state.preferences = {
                categoryWeights: {},
                typeWeights: {},
                countryWeights: {},
                keywordWeights: {},
                preferredYear: null,
                preferredRating: null
            };
            applyFavoritesState();
            saveFavoritesCache();
            emptyFavs.style.display = '';
            return;
        }

        applyFavoritesState();
        saveFavoritesCache();
        ensureFavoriteDetailsForVisible();
    } catch (err) {
        console.error('Firestore favorites load failed:', err);
        if (state.favoriteOrderIds.length === 0) {
            emptyFavs.style.display = '';
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
    const normalized = {
        id: film.kinopoiskId || film.filmId || film.id,
        title: film.nameRu || film.nameEn || film.title || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f',
        poster: film.posterUrlPreview || film.posterUrl || film.poster || '',
        posterFull: film.posterUrl || film.posterUrlPreview || film.posterFull || '',
        rating: film.ratingKinopoisk || film.rating || null,
        year: film.year || '',
        description: film.description || film.shortDescription || '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442',
        genres,
        genresText: genres.join(', '),
        countries,
        countriesText: countries.join(', '),
        type: film.type || contentType,
        contentType
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

    const selected = [...state.selectedCategoryIds];
    const selectedSet = new Set(selected);
    const nonSelected = state.allCategories.filter((category) => !selectedSet.has(category.id) && category.id !== 'all');
    const sorted = [
        ...selected.map((id) => CATEGORY_BY_ID.get(id)).filter(Boolean),
        CATEGORY_BY_ID.get('all'),
        ...nonSelected
    ].filter(Boolean);

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

/**
 * Р—Р°РіСЂСѓР¶Р°РµС‚ СЃРїРёСЃРѕРє С„РёР»СЊРјРѕРІ СЃ СѓС‡РµС‚РѕРј РІС‹Р±СЂР°РЅРЅС‹С… РєР°С‚РµРіРѕСЂРёР№.
 */
async function fetchMovies(options = 1) {
    const page = typeof options === 'number' ? options : (options?.page || 1);
    const limit = options?.limit || 24;
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
    const url = `${BACKEND_API_BASE}/api/movies?${query.toString()}`;

    const response = await fetch(url, {
        method: 'GET'
    });

    if (!response.ok) {
        throw new Error(`\u041e\u0448\u0438\u0431\u043a\u0430 API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawFilms = data.items || data.films || [];

    return rawFilms.map(normalizeMovie);
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
    const plans = [{ page: basePage, limit: 24 }];
    if (state.selectedCategoryIds.size === 0) {
        plans.push({ page: basePage + 1, limit: 18 });
    }

    if (!hasUserPreferenceSignals() && state.selectedCategoryIds.size === 0) {
        const randomCategory = pickRandomCategoryId();
        if (randomCategory) {
            plans.push({
                page: basePage,
                limit: 12,
                categories: [randomCategory]
            });
        }
    }
    return plans;
}

async function fetchCandidateMovies(basePage) {
    const plans = buildFetchPlans(basePage);
    const results = await Promise.all(
        plans.map((plan) => fetchMovies(plan).catch(() => []))
    );
    return mergeUniqueMovies(results.flat());
}

/**
 * Р—Р°РіСЂСѓР¶Р°РµС‚ РґРµС‚Р°Р»СЊРЅСѓСЋ РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ С„РёР»СЊРјРµ.
 */
async function fetchMovieDetails(filmId) {
    try {
        const url = `${BACKEND_API_BASE}/api/movies/${filmId}`;
        const response = await fetch(url, {
            method: 'GET'
        });

        if (!response.ok) return null;
        const data = await response.json();

        return {
            title: data.nameRu || data.nameEn || null,
            description: data.description || data.shortDescription || '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442',
            genres: (data.genres || []).map(g => g.genre).join(', '),
            countries: (data.countries || []).map((c) => c.country).join(', '),
            year: data.year || '',
            rating: data.ratingKinopoisk || null,
            poster: data.posterUrlPreview || '',
            posterFull: data.posterUrl || ''
        };
    } catch {
        return null;
    }
}

// ============================================================
// Р—Р°РіСЂСѓР·РєР° Рё РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ РєР°СЂС‚РѕС‡РµРє
// ============================================================

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
        let movies = [];
        let effectivePage = state.page;
        for (let attempt = 0; attempt < 2; attempt++) {
            const fetched = await fetchCandidateMovies(effectivePage);
            const unseen = filterUnseenMovies(fetched);
            movies = filterRecentlyShownMovies(unseen);
            if (movies.length > 0 || fetched.length === 0) break;
            effectivePage += 1;
        }

        if (movies.length === 0) {
            showEmpty();
            return;
        }

        computePreferences();
        state.page = effectivePage;
        state.movies = hasUserPreferenceSignals()
            ? sortMoviesForUser(movies)
            : sortColdStartMovies(movies);
        state.currentIndex = 0;
        state.lastShownMovieId = null;
        renderCards();

        loader.style.display = 'none';
        swipeActions.style.display = 'flex';
    } catch (err) {
        console.error('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438:', err);
        loader.style.display = 'none';
        errorState.style.display = '';
        errorMessage.textContent = err.message || '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u0438 API \u043a\u043b\u044e\u0447';
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
// Р РµРЅРґРµСЂРёРЅРі РєР°СЂС‚РѕС‡РµРє (СЃС‚РµРє)
// ============================================================

function renderCards() {
    cardStack.innerHTML = '';

    const remaining = state.movies.slice(state.currentIndex);
    const visible = remaining.slice(0, 3);

    visible.forEach((movie, i) => {
        const card = createCardElement(movie, i);
        cardStack.appendChild(card);
    });

    const topCard = cardStack.querySelector('.movie-card');
    if (topCard) {
        const topMovie = visible[0];
        if (topMovie && topMovie.id !== state.lastShownMovieId) {
            markMovieAsShown(topMovie.id);
            state.lastShownMovieId = topMovie.id;
        }
        enableSwipe(topCard);
    }
}

function createCardElement(movie, stackIndex) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.dataset.id = movie.id;

    const scale = 1 - stackIndex * 0.04;
    const translateY = stackIndex * 10;
    card.style.transform = `translateY(${translateY}px) scale(${scale})`;
    card.style.zIndex = 10 - stackIndex;
    card.style.opacity = stackIndex < 3 ? 1 : 0;

    const ratingHtml = movie.rating
        ? `<span class="card-rating">
               <svg width="14" height="14" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
               ${movie.rating}
           </span>`
        : '';
    const genresText = movie.genresText || (Array.isArray(movie.genres) ? movie.genres.join(', ') : (movie.genres || ''));

    card.innerHTML = `
        <div class="card-bg" style="background-image: url('${movie.poster}')"></div>
        <div class="card-gradient"></div>
        <span class="swipe-stamp like">\u2764\uFE0F</span>
        <span class="swipe-stamp dislike">\u2715</span>
        <div class="card-info">
            <div class="card-title">${movie.title}</div>
            <div class="card-meta">
                ${ratingHtml}
                <span class="card-year">${movie.year}</span>
            </div>
            ${genresText ? `<div class="card-genres">${genresText}</div>` : ''}
            ${movie.description && movie.description !== '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442'
            ? `<div class="card-desc">${movie.description}</div>`
            : ''
        }
        </div>
    `;

    return card;
}

// ============================================================
// РЎРІР°Р№Рї-РјРµС…Р°РЅРёРєР° (touch + mouse)
// ============================================================

function enableSwipe(card) {
    let startX = 0, startY = 0;
    let currentX = 0;
    let isDragging = false;

    const stampLike = card.querySelector('.swipe-stamp.like');
    const stampDislike = card.querySelector('.swipe-stamp.dislike');

    function onStart(e) {
        isDragging = true;
        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;
        card.style.transition = 'none';
    }

    function onMove(e) {
        if (!isDragging) return;
        const point = e.touches ? e.touches[0] : e;
        currentX = point.clientX - startX;

        const rotation = currentX * 0.08;
        card.style.transform = `translateX(${currentX}px) rotate(${rotation}deg)`;

        const threshold = 60;
        if (currentX > threshold) {
            stampLike.classList.add('visible');
            stampDislike.classList.remove('visible');
        } else if (currentX < -threshold) {
            stampDislike.classList.add('visible');
            stampLike.classList.remove('visible');
        } else {
            stampLike.classList.remove('visible');
            stampDislike.classList.remove('visible');
        }
    }

    function onEnd() {
        if (!isDragging) return;
        isDragging = false;

        const swipeThreshold = 100;

        if (currentX > swipeThreshold) {
            // РЎРІР°Р№Рї РІРїСЂР°РІРѕ вЂ” Р›РђР™Рљ в†’ СЃРѕС…СЂР°РЅСЏРµРј РІ Firebase
            flyAway(card, 'right');
            addToFavorites(state.movies[state.currentIndex]);
        } else if (currentX < -swipeThreshold) {
            flyAway(card, 'left');
        } else {
            card.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            card.style.transform = 'translateY(0) scale(1)';
            stampLike.classList.remove('visible');
            stampDislike.classList.remove('visible');
        }

        currentX = 0;
    }

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: true });
    card.addEventListener('touchend', onEnd);
    card.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
}

function flyAway(card, direction) {
    const flyX = direction === 'right' ? window.innerWidth : -window.innerWidth;
    const rotation = direction === 'right' ? 30 : -30;

    card.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
    card.style.transform = `translateX(${flyX}px) rotate(${rotation}deg)`;
    card.style.opacity = '0';
    const currentMovie = state.movies[state.currentIndex];
    if (currentMovie) {
        if (direction === 'right') {
            markMovieLiked(currentMovie.id);
        } else if (direction === 'left') {
            markMovieDisliked(currentMovie.id);
        }
        markMovieAsSeen(currentMovie.id);
        computePreferences();
    }

    card.addEventListener('transitionend', () => {
        state.currentIndex++;
        if (state.currentIndex >= state.movies.length) {
            showEmpty();
        } else {
            renderCards();
        }
    }, { once: true });
}

// ============================================================
// РР·Р±СЂР°РЅРЅРѕРµ (Firestore + Р»РѕРєР°Р»СЊРЅС‹Р№ РєСЌС€)
// ============================================================

/**
 * Р”РѕР±Р°РІРёС‚СЊ С„РёР»СЊРј РІ РёР·Р±СЂР°РЅРЅРѕРµ:
 * 1. Р›РѕРєР°Р»СЊРЅРѕ (state.favorites)
 * 2. Р’ Firestore (users/{uid}/favorites/{filmId})
 */
function addToFavorites(movie) {
    if (!movie || !Number.isFinite(movie.id)) return;
    // РќРµ РґРѕР±Р°РІР»СЏРµРј РґСѓР±Р»РёРєР°С‚С‹
    if (state.favoriteIds.has(movie.id)) return;

    markMovieLiked(movie.id);
    state.favoriteIds.add(movie.id);
    state.favoriteOrderIds.unshift(movie.id);
    upsertFavoriteDetail(movie);
    state.favoritesVisibleCount = Math.max(state.favoritesVisibleCount, FAVORITES_PAGE_SIZE);
    computePreferences();
    updateFavBadge();
    renderFavorites();
    saveFavoritesCache();

    // РђСЃРёРЅС…СЂРѕРЅРЅРѕ СЃРѕС…СЂР°РЅСЏРµРј РІ Firestore
    saveToFirestore(movie);
}

/**
 * РЈРґР°Р»РёС‚СЊ С„РёР»СЊРј РёР· РёР·Р±СЂР°РЅРЅРѕРіРѕ (Р»РѕРєР°Р»СЊРЅРѕ + Firestore)
 */
function removeFromFavorites(movieId) {
    const normalizedId = Number(movieId);
    if (!Number.isFinite(normalizedId)) return;
    state.favoriteIds.delete(normalizedId);
    state.favoriteOrderIds = state.favoriteOrderIds.filter((id) => id !== normalizedId);
    state.favoriteDetailsById.delete(normalizedId);
    syncFavoritesArray();
    computePreferences();
    updateFavBadge();
    renderFavorites();
    if (state.movies.length > 0) {
        state.movies = sortMoviesForUser(state.movies);
        state.currentIndex = 0;
        renderCards();
    }

    // РђСЃРёРЅС…СЂРѕРЅРЅРѕ СѓРґР°Р»СЏРµРј РёР· Firestore
    deleteFromFirestore(normalizedId);
    saveFavoritesCache();
}

function updateFavBadge() {
    const count = state.favoriteIds.size;
    if (count > 0) {
        favBadge.textContent = count;
        favBadge.style.display = 'inline-block';
    } else {
        favBadge.style.display = 'none';
    }
}

function renderFavorites() {
    favGrid.innerHTML = '';

    if (state.favoriteOrderIds.length === 0) {
        emptyFavs.style.display = '';
        emptyFavs.classList.remove('hidden');
        return;
    }

    emptyFavs.style.display = 'none';
    emptyFavs.classList.add('hidden');

    const visibleIds = state.favoriteOrderIds.slice(0, state.favoritesVisibleCount);
    visibleIds.forEach((id, i) => {
        const movie = state.favoriteDetailsById.get(id);
        const card = document.createElement('div');
        card.className = movie ? 'fav-card' : 'fav-card skeleton';
        card.style.animationDelay = `${i * 0.06}s`;
        if (movie) {
            const genresText = movie.genresText || (Array.isArray(movie.genres) ? movie.genres.join(', ') : (movie.genres || ''));
            card.innerHTML = `
                <img src="${movie.poster}" alt="${movie.title}" loading="lazy">
                <div class="fav-info">
                    <div class="fav-title">${movie.title}</div>
                    ${movie.rating ? `<div class="fav-rating">\u2B50 ${movie.rating}</div>` : ''}
                    ${genresText ? `<div class="fav-genres">${genresText}</div>` : ''}
                </div>
            `;
            card.addEventListener('click', () => openPopup(movie));
        } else {
            card.innerHTML = `
                <div class="skeleton-poster"></div>
                <div class="fav-info">
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line short"></div>
                </div>
            `;
        }
        favGrid.appendChild(card);
    });

    if (state.favoriteOrderIds.length > state.favoritesVisibleCount) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'reset-btn';
        moreBtn.textContent = 'Показать ещё';
        moreBtn.style.gridColumn = '1 / -1';
        moreBtn.addEventListener('click', () => {
            state.favoritesVisibleCount += FAVORITES_PAGE_SIZE;
            renderFavorites();
        });
        favGrid.appendChild(moreBtn);
    }

    ensureFavoriteDetailsForVisible();
}

// ============================================================
// Popup вЂ” Р”РµС‚Р°Р»Рё С„РёР»СЊРјР°
// ============================================================

let currentPopupMovie = null;

async function openPopup(movie) {
    currentPopupMovie = movie;
    markMovieOpened(movie.id);
    computePreferences();

    popupPoster.style.backgroundImage = `url('${movie.posterFull || movie.poster}')`;
    popupTitle.textContent = movie.title;
    popupYear.textContent = movie.year || '';
    popupRating.textContent = movie.rating ? `\u2B50 ${movie.rating}` : '';
    popupGenre.textContent = movie.genresText || movie.genres || '';
    popupDesc.textContent = movie.description || '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...';

    popupOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Р•СЃР»Рё РѕРїРёСЃР°РЅРёРµ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ вЂ” Р·Р°РіСЂСѓР¶Р°РµРј СЃ API
    if (!movie.description || movie.description === '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442') {
        const details = await fetchMovieDetails(movie.id);
        if (details) {
            popupDesc.textContent = details.description;
            if (details.genres) popupGenre.textContent = details.genres;
            movie.description = details.description;
            movie.genresText = details.genres || movie.genresText;
        }
    }
}

function closePopup() {
    popupOverlay.classList.remove('active');
    document.body.style.overflow = '';
    currentPopupMovie = null;
}

// ============================================================
// РќР°РІРёРіР°С†РёСЏ РїРѕ С‚Р°Р±Р°Рј
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

    // РџСЂРё РїРµСЂРµРєР»СЋС‡РµРЅРёРё РЅР° В«РР·Р±СЂР°РЅРЅРѕРµВ» вЂ” Р·Р°РіСЂСѓР¶Р°РµРј РёР· Firestore
    if (tab === 'favorites') {
        loadFavoritesFromFirestore();
    }
}

// ============================================================
// РћР±СЂР°Р±РѕС‚РєР° С„РёР»СЊС‚СЂРѕРІ РєР°С‚РµРіРѕСЂРёР№
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
// РљРЅРѕРїРєРё Like/Dislike
// ============================================================

function handleButtonSwipe(direction) {
    const topCard = cardStack.querySelector('.movie-card');
    if (!topCard) return;

    if (direction === 'right') {
        addToFavorites(state.movies[state.currentIndex]);
    }
    flyAway(topCard, direction);
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

function toggleUserMenu() {
    userMenu.classList.toggle('active');
}

function closeUserMenu(e) {
    if (!userMenu.contains(e.target) && e.target !== $('btn-user')) {
        userMenu.classList.remove('active');
    }
}

// ============================================================
// РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ
// ============================================================

function init() {
    // --- Auth forms ---
    formLogin.addEventListener('submit', handleLogin);
    formRegister.addEventListener('submit', handleRegister);

    // РџРµСЂРµРєР»СЋС‡РµРЅРёРµ Login <-> Register
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
    $('btn-logout').addEventListener('click', () => {
        userMenu.classList.remove('active');
        handleLogout();
    });
    document.addEventListener('click', closeUserMenu);

    // --- Tabs ---
    $('tab-discover').addEventListener('click', () => switchTab('discover'));
    $('tab-favorites').addEventListener('click', () => switchTab('favorites'));

    // --- РљР°С‚РµРіРѕСЂРёРё ---
    renderCategoryFilters();

    // --- РљРЅРѕРїРєРё СЃРІР°Р№РїР° ---
    $('btn-like').addEventListener('click', () => handleButtonSwipe('right'));
    $('btn-dislike').addEventListener('click', () => handleButtonSwipe('left'));

    // --- РљРЅРѕРїРєР° В«Р—Р°РіСЂСѓР·РёС‚СЊ РµС‰С‘В» ---
    $('btn-reset').addEventListener('click', () => {
        state.page++;
        loadMovies();
    });

    // --- РљРЅРѕРїРєР° В«РџРѕРїСЂРѕР±РѕРІР°С‚СЊ СЃРЅРѕРІР°В» ---
    $('btn-retry').addEventListener('click', () => loadMovies());

    // --- Popup ---
    $('popup-close').addEventListener('click', closePopup);
    $('popup-overlay').addEventListener('click', (e) => {
        if (e.target === popupOverlay) closePopup();
    });
    $('popup-delete').addEventListener('click', () => {
        if (currentPopupMovie) {
            removeFromFavorites(currentPopupMovie.id);
            closePopup();
        }
    });

    // --- Firebase Auth Observer ---
    // РЎР»РµРґРёС‚ Р·Р° РІС…РѕРґРѕРј/РІС‹С…РѕРґРѕРј Рё Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРµСЂРµРєР»СЋС‡Р°РµС‚ СЌРєСЂР°РЅС‹
    setupAuthObserver();
}

// Р—Р°РїСѓСЃРє
document.addEventListener('DOMContentLoaded', init);
