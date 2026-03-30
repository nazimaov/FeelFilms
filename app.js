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
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    deleteDoc,
    getDocs,
    query,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// =====================================================
// ⚠️  FIREBASE CONFIG — ВСТАВЬ СВОИ ДАННЫЕ  ⚠️
// Получить config можно в Firebase Console:
// Project Settings -> General -> Your apps -> Web app
// =====================================================
const firebaseConfig = {
    apiKey: "AIzaSyAGLtsZXNg1s_a249Sv0p5cMQgkXbjfKPQ",
    authDomain: "feelfilm-13a52.firebaseapp.com",
    projectId: "feelfilm-13a52",
    storageBucket: "feelfilm-13a52.firebasestorage.app",
    messagingSenderId: "524135203863",
    appId: "1:524135203863:android:7a5af35c009ecc23ac4852"
};
// =====================================================
const BACKEND_API_BASE =
    window.FEELFILMS_BACKEND_API_BASE ||
    localStorage.getItem('feelfilms_backend_api_base') ||
    (location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '');

// --- Инициализация Firebase ---
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// --- Маппинг настроений на жанры КиноПоиска ---
const CATEGORY_DEFINITIONS = [
    { id: 'all', label: 'Все', icon: '🎭', keywords: [], contentType: 'ALL' },
    { id: 'comedy', label: 'Комедия', icon: '😂', keywords: ['комед'], contentType: 'FILM' },
    { id: 'horror', label: 'Ужасы', icon: '👻', keywords: ['ужас'], contentType: 'FILM' },
    { id: 'action', label: 'Экшн', icon: '💥', keywords: ['боевик', 'экшн'], contentType: 'FILM' },
    { id: 'thriller', label: 'Триллер', icon: '🕵️', keywords: ['триллер'], contentType: 'FILM' },
    { id: 'detective', label: 'Детектив', icon: '🧩', keywords: ['детектив'], contentType: 'FILM' },
    { id: 'fantasy', label: 'Фантастика', icon: '🚀', keywords: ['фантаст'], contentType: 'FILM' },
    { id: 'fantasy_world', label: 'Фэнтези', icon: '🐉', keywords: ['фэнтези'], contentType: 'FILM' },
    { id: 'drama', label: 'Драма', icon: '🎬', keywords: ['драма'], contentType: 'FILM' },
    { id: 'romance', label: 'Романтика', icon: '💞', keywords: ['мелодрам', 'романт'], contentType: 'FILM' },
    { id: 'adventure', label: 'Приключения', icon: '🧭', keywords: ['приключ'], contentType: 'FILM' },
    { id: 'family', label: 'Семейное', icon: '👨‍👩‍👧', keywords: ['семейн', 'детск'], contentType: 'FILM' },
    { id: 'crime', label: 'Криминал', icon: '🚔', keywords: ['криминал'], contentType: 'FILM' },
    { id: 'mystic', label: 'Мистика', icon: '🌫️', keywords: ['мистик'], contentType: 'FILM' },
    { id: 'anime', label: 'Аниме', icon: '🌸', keywords: ['аниме'], contentType: 'FILM' },
    { id: 'cartoon', label: 'Мультфильмы', icon: '🧸', keywords: ['мульт', 'анимац'], contentType: 'CARTOON' },
    { id: 'documentary', label: 'Документальное', icon: '🎥', keywords: ['документ'], contentType: 'FILM' },
    { id: 'history', label: 'Историческое', icon: '🏛️', keywords: ['истор'], contentType: 'FILM' },
    { id: 'psychological', label: 'Психологическое', icon: '🧠', keywords: ['психолог'], contentType: 'FILM' },
    { id: 'series', label: 'Сериалы', icon: '📺', keywords: ['сериал'], contentType: 'TV_SERIES' },
    { id: 'short', label: 'Короткометражки', icon: '⏱️', keywords: ['короткометраж'], contentType: 'FILM' }
];

const CATEGORY_BY_ID = new Map(CATEGORY_DEFINITIONS.map((category) => [category.id, category]));

// --- Маппинг ошибок Firebase на русский ---
const AUTH_ERRORS = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован',
    'auth/invalid-email': 'Некорректный email',
    'auth/weak-password': 'Пароль слишком простой (мин. 6 символов)',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/invalid-credential': 'Неверный email или пароль',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
    'auth/network-request-failed': 'Ошибка сети. Проверьте подключение'
};

// --- Состояние приложения ---
const state = {
    user: null,          // Текущий пользователь Firebase
    movies: [],          // Текущий стек карточек
    currentIndex: 0,     // Индекс текущей верхней карточки
    favorites: [],       // Избранные фильмы (из Firestore)
    favoriteIds: new Set(), // Set ID для быстрой проверки дубликатов
    allCategories: CATEGORY_DEFINITIONS,
    selectedCategoryIds: new Set(),
    preferences: {
        categoryWeights: {},
        typeWeights: {}
    },
    page: 1,             // Текущая страница API
    isLoading: false,
    currentTab: 'discover'
};

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

        console.log('✅ Регистрация успешна:', cred.user.email);
        // onAuthStateChanged автоматически переключит на основной экран
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        registerError.textContent = AUTH_ERRORS[err.code] || err.message;
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
        loginError.textContent = AUTH_ERRORS[err.code] || err.message;
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
    } catch (err) {
        console.error('❌ Ошибка выхода:', err);
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
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // ✅ Пользователь вошёл
            state.user = user;
            showMainApp(user);
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
function showMainApp(user) {
    screenAuth.classList.remove('active');
    screenAuth.style.display = 'none';
    mainApp.style.display = 'flex';

    // Обновляем UI профиля
    const displayName = user.displayName || 'Пользователь';
    userName.textContent = displayName;
    userEmail.textContent = user.email;
    userAvatar.textContent = displayName.charAt(0).toUpperCase();

    // Загрузить фильмы
    loadMovies();
}

/**
 * Показать экран авторизации
 */
function showAuthScreen() {
    mainApp.style.display = 'none';
    screenAuth.style.display = 'flex';
    screenAuth.classList.add('active');

    // Очищаем состояние
    state.favorites = [];
    state.favoriteIds.clear();
    state.preferences = { categoryWeights: {}, typeWeights: {} };
    state.selectedCategoryIds.clear();
    state.movies = [];
    cardStack.innerHTML = '';
    favGrid.innerHTML = '';
    renderCategoryFilters();
    updateFavBadge();
}

// ============================================================
// FIRESTORE — Избранное в облаке
// ============================================================

/**
 * Путь к коллекции favorites текущего пользователя:
 * users/{user_id}/favorites/{film_id}
 */
function getFavoritesRef() {
    return collection(db, 'users', state.user.uid, 'favorites');
}

/**
 * Сохраняет фильм в Firestore (при свайпе вправо)
 */
async function saveToFirestore(movie) {
    if (!state.user) return;

    try {
        const docRef = doc(db, 'users', state.user.uid, 'favorites', String(movie.id));
        await setDoc(docRef, {
            filmId: movie.id,
            title: movie.title,
            poster: movie.poster,
            posterFull: movie.posterFull || movie.poster,
            rating: movie.rating || null,
            year: movie.year || '',
            description: movie.description || '',
            genres: movie.genresText || (Array.isArray(movie.genres) ? movie.genres.join(', ') : movie.genres) || '',
            type: movie.contentType || movie.type || 'FILM',
            addedAt: serverTimestamp()
        });
        console.log('☁️ Сохранено в Firestore:', movie.title);
    } catch (err) {
        console.error('❌ Ошибка записи в Firestore:', err);
    }
}

/**
 * Удаляет фильм из Firestore
 */
async function deleteFromFirestore(movieId) {
    if (!state.user) return;

    try {
        const docRef = doc(db, 'users', state.user.uid, 'favorites', String(movieId));
        await deleteDoc(docRef);
        console.log('☁️ Удалено из Firestore:', movieId);
    } catch (err) {
        console.error('❌ Ошибка удаления из Firestore:', err);
    }
}

/**
 * Загружает список избранных ID из Firebase,
 * затем подгружает данные по фильмам через API КиноПоиска.
 */
async function loadFavoritesFromFirestore() {
    if (!state.user) return;

    favLoader.style.display = '';
    favGrid.innerHTML = '';
    emptyFavs.style.display = 'none';

    try {
        // 1) Скачиваем документы из Firestore
        const q = query(getFavoritesRef());
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            favLoader.style.display = 'none';
            emptyFavs.style.display = '';
            state.favorites = [];
            state.favoriteIds.clear();
            state.preferences = { categoryWeights: {}, typeWeights: {} };
            updateFavBadge();
            return;
        }

        // 2) Собираем данные — если в документе есть title, используем,
        //    иначе подгрузим через API.
        const movies = [];
        const needFetch = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const movieData = {
                id: data.filmId || parseInt(docSnap.id),
                title: data.title || null,
                poster: data.poster || '',
                posterFull: data.posterFull || data.poster || '',
                rating: data.rating || null,
                year: data.year || '',
                description: data.description || '',
                genres: data.genres || '',
                type: data.type || 'FILM'
            };

            if (movieData.title) {
                movies.push(movieData);
            } else {
                // Нет данных — загрузим через API
                needFetch.push(movieData);
            }

            state.favoriteIds.add(movieData.id);
        });

        // 3) Подгружаем недостающие данные через Kinopoisk API
        if (needFetch.length > 0) {
            const fetchPromises = needFetch.map(async (m) => {
                const details = await fetchMovieDetails(m.id);
                if (details) {
                    m.title = details.title || `Фильм #${m.id}`;
                    m.description = details.description;
                    m.genres = details.genres;
                    m.year = details.year;
                    m.rating = details.rating;
                    m.poster = details.poster || m.poster;
                    m.posterFull = details.posterFull || m.posterFull;
                }
                return m;
            });
            const fetched = await Promise.all(fetchPromises);
            movies.push(...fetched);
        }

        state.favorites = movies;
        computePreferences();
        updateFavBadge();
        favLoader.style.display = 'none';
        renderFavorites();

    } catch (err) {
        console.error('❌ Ошибка загрузки из Firestore:', err);
        favLoader.style.display = 'none';
        emptyFavs.style.display = '';
    }
}

// ============================================================
// API — Загрузка фильмов с КиноПоиска
// ============================================================

function normalizeGenres(source) {
    if (Array.isArray(source)) {
        return source.map((genre) => (genre.genre || '').toString()).filter(Boolean);
    }
    if (typeof source === 'string') {
        return source.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function inferContentType(rawType, genres) {
    const type = (rawType || '').toString().toUpperCase();
    const joinedGenres = genres.join(' ').toLowerCase();
    if (type.includes('TV') || joinedGenres.includes('сериал')) return 'TV_SERIES';
    if (joinedGenres.includes('мульт') || joinedGenres.includes('анимац')) return 'CARTOON';
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
    const contentType = inferContentType(film.type, genres);
    const normalized = {
        id: film.kinopoiskId || film.filmId || film.id,
        title: film.nameRu || film.nameEn || film.title || 'Без названия',
        poster: film.posterUrlPreview || film.posterUrl || film.poster || '',
        posterFull: film.posterUrl || film.posterUrlPreview || film.posterFull || '',
        rating: film.ratingKinopoisk || film.rating || null,
        year: film.year || '',
        description: film.description || film.shortDescription || 'Описание отсутствует',
        genres,
        genresText: genres.join(', '),
        type: film.type || contentType,
        contentType
    };
    normalized.categoryIds = inferMovieCategoryIds(normalized);
    return normalized;
}

function getSelectedCategories() {
    return [...state.selectedCategoryIds].map((id) => CATEGORY_BY_ID.get(id)).filter(Boolean);
}

function computePreferences() {
    const categoryScores = {};
    const typeScores = {};
    state.favorites.forEach((movie) => {
        const normalizedMovie = normalizeMovie(movie);
        normalizedMovie.categoryIds.forEach((categoryId) => {
            categoryScores[categoryId] = (categoryScores[categoryId] || 0) + 1;
        });
        typeScores[normalizedMovie.contentType] = (typeScores[normalizedMovie.contentType] || 0) + 1;
    });

    const categoryMax = Math.max(1, ...Object.values(categoryScores));
    const typeMax = Math.max(1, ...Object.values(typeScores));
    const categoryWeights = {};
    const typeWeights = {};

    Object.entries(categoryScores).forEach(([categoryId, score]) => {
        categoryWeights[categoryId] = Number(score) / categoryMax;
    });
    Object.entries(typeScores).forEach(([type, score]) => {
        typeWeights[type] = Number(score) / typeMax;
    });

    state.preferences = { categoryWeights, typeWeights };
}

function scoreMovie(movie) {
    let score = 0;
    const rating = Number(movie.rating);
    if (!Number.isNaN(rating)) {
        score += rating * 3;
    }

    const selected = [...state.selectedCategoryIds];
    if (selected.length > 0) {
        const matches = selected.filter((id) => movie.categoryIds.includes(id));
        if (matches.length > 0) {
            score += 80 + matches.length * 25;
        } else {
            score -= 35;
        }
    }

    movie.categoryIds.forEach((categoryId) => {
        score += (state.preferences.categoryWeights[categoryId] || 0) * 35;
    });
    score += (state.preferences.typeWeights[movie.contentType] || 0) * 20;

    if (state.favoriteIds.has(movie.id)) {
        score -= 500;
    }
    return score;
}

function sortMoviesForUser(movies) {
    return [...movies]
        .map((movie) => ({ ...movie, recommendationScore: scoreMovie(movie) }))
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
    if (selectedTypes.length === 1) {
        return selectedTypes[0];
    }
    return 'ALL';
}

function getCategoryQueryValue() {
    const selected = [...state.selectedCategoryIds];
    return selected.length > 0 ? selected.join(',') : 'all';
}

/**
 * Загружает список фильмов с учетом выбранных категорий.
 */
async function fetchMovies(page = 1) {
    const query = new URLSearchParams({
        page: String(page),
        mood: 'all',
        categories: getCategoryQueryValue(),
        content_type: getPreferredContentType()
    });
    const url = `${BACKEND_API_BASE}/api/movies?${query.toString()}`;

    const response = await fetch(url, {
        method: 'GET'
    });

    if (!response.ok) {
        throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawFilms = data.items || data.films || [];

    return rawFilms.map(normalizeMovie);
}

/**
 * Загружает детальную информацию о фильме.
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
            description: data.description || data.shortDescription || 'Описание отсутствует',
            genres: (data.genres || []).map(g => g.genre).join(', '),
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
// Загрузка и отображение карточек
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
        const movies = await fetchMovies(state.page);
        if (movies.length === 0) {
            showEmpty();
            return;
        }

        state.movies = sortMoviesForUser(movies);
        state.currentIndex = 0;
        renderCards();

        loader.style.display = 'none';
        swipeActions.style.display = 'flex';
    } catch (err) {
        console.error('Ошибка загрузки:', err);
        loader.style.display = 'none';
        errorState.style.display = '';
        errorMessage.textContent = err.message || 'Проверьте соединение и API ключ';
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
    const visible = remaining.slice(0, 3);

    visible.forEach((movie, i) => {
        const card = createCardElement(movie, i);
        cardStack.appendChild(card);
    });

    const topCard = cardStack.querySelector('.movie-card');
    if (topCard) {
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

    card.innerHTML = `
        <div class="card-bg" style="background-image: url('${movie.poster}')"></div>
        <div class="card-gradient"></div>
        <span class="swipe-stamp like">❤️</span>
        <span class="swipe-stamp dislike">✕</span>
        <div class="card-info">
            <div class="card-title">${movie.title}</div>
            <div class="card-meta">
                ${ratingHtml}
                <span class="card-year">${movie.year}</span>
            </div>
            ${movie.description && movie.description !== 'Описание отсутствует'
            ? `<div class="card-desc">${movie.description}</div>`
            : ''
        }
        </div>
    `;

    return card;
}

// ============================================================
// Свайп-механика (touch + mouse)
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
            // Свайп вправо — ЛАЙК → сохраняем в Firebase
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
// Избранное (Firestore + локальный кэш)
// ============================================================

/**
 * Добавить фильм в избранное:
 * 1. Локально (state.favorites)
 * 2. В Firestore (users/{uid}/favorites/{filmId})
 */
function addToFavorites(movie) {
    // Не добавляем дубликаты
    if (state.favoriteIds.has(movie.id)) return;

    state.favorites.push(movie);
    state.favoriteIds.add(movie.id);
    computePreferences();
    updateFavBadge();
    if (state.movies.length > 0) {
        state.movies = sortMoviesForUser(state.movies);
    }

    // Асинхронно сохраняем в Firestore
    saveToFirestore(movie);
}

/**
 * Удалить фильм из избранного (локально + Firestore)
 */
function removeFromFavorites(movieId) {
    state.favorites = state.favorites.filter(f => f.id !== movieId);
    state.favoriteIds.delete(movieId);
    computePreferences();
    updateFavBadge();
    renderFavorites();
    if (state.movies.length > 0) {
        state.movies = sortMoviesForUser(state.movies);
        state.currentIndex = 0;
        renderCards();
    }

    // Асинхронно удаляем из Firestore
    deleteFromFirestore(movieId);
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

    if (state.favorites.length === 0) {
        emptyFavs.style.display = '';
        emptyFavs.classList.remove('hidden');
        return;
    }

    emptyFavs.style.display = 'none';
    emptyFavs.classList.add('hidden');

    state.favorites.forEach((movie, i) => {
        const card = document.createElement('div');
        card.className = 'fav-card';
        card.style.animationDelay = `${i * 0.06}s`;
        card.innerHTML = `
            <img src="${movie.poster}" alt="${movie.title}" loading="lazy">
            <div class="fav-info">
                <div class="fav-title">${movie.title}</div>
                ${movie.rating ? `<div class="fav-rating">⭐ ${movie.rating}</div>` : ''}
            </div>
        `;
        card.addEventListener('click', () => openPopup(movie));
        favGrid.appendChild(card);
    });
}

// ============================================================
// Popup — Детали фильма
// ============================================================

let currentPopupMovie = null;

async function openPopup(movie) {
    currentPopupMovie = movie;

    popupPoster.style.backgroundImage = `url('${movie.posterFull || movie.poster}')`;
    popupTitle.textContent = movie.title;
    popupYear.textContent = movie.year || '';
    popupRating.textContent = movie.rating ? `⭐ ${movie.rating}` : '';
    popupGenre.textContent = movie.genresText || movie.genres || '';
    popupDesc.textContent = movie.description || 'Загрузка…';

    popupOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Если описание отсутствует — загружаем с API
    if (!movie.description || movie.description === 'Описание отсутствует') {
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
    $('btn-logout').addEventListener('click', () => {
        userMenu.classList.remove('active');
        handleLogout();
    });
    document.addEventListener('click', closeUserMenu);

    // --- Tabs ---
    $('tab-discover').addEventListener('click', () => switchTab('discover'));
    $('tab-favorites').addEventListener('click', () => switchTab('favorites'));

    // --- Категории ---
    renderCategoryFilters();

    // --- Кнопки свайпа ---
    $('btn-like').addEventListener('click', () => handleButtonSwipe('right'));
    $('btn-dislike').addEventListener('click', () => handleButtonSwipe('left'));

    // --- Кнопка «Загрузить ещё» ---
    $('btn-reset').addEventListener('click', () => {
        state.page++;
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
        if (currentPopupMovie) {
            removeFromFavorites(currentPopupMovie.id);
            closePopup();
        }
    });

    // --- Firebase Auth Observer ---
    // Следит за входом/выходом и автоматически переключает экраны
    setupAuthObserver();
}

// Запуск
document.addEventListener('DOMContentLoaded', init);
