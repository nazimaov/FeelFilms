/* FeelFilm Admin — минимальный service worker.
 * Задача: сделать страницу устанавливаемой как PWA (Chrome требует наличие SW)
 * и подстилать простую заглушку, если нет сети — админка живая, offline не
 * работает по природе (нужны Firebase + бэкенд), но хотя бы не покажет
 * страшную страницу «нет интернета».
 */

const CACHE = 'ff-admin-v1';
const APP_SHELL = [
  '/admin/',
  '/admin/index.html',
  '/admin/admin.css',
  '/admin/admin.js',
  '/admin/manifest.webmanifest',
  '/admin/icon-192.png',
  '/admin/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Оставляем как есть: API-запросы (данные всегда свежие), Firebase, GStatic.
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }
  // App shell — сначала сеть, при падении отдаём из кэша.
  e.respondWith(
    fetch(req).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(req).then((r) => r || caches.match('/admin/index.html')))
  );
});
