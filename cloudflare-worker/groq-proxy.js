/**
 * FeelFilm — прокси к Groq через Cloudflare Worker.
 *
 * Зачем: сервер FeelFilm в РФ, а Groq (api.groq.com) блокирует российские IP.
 * Cloudflare Worker выполняется вне РФ (напр. Франкфурт) и ходит к Groq оттуда.
 *
 * ВАЖНО: пересылаем в Groq ТОЛЬКО чистые заголовки (Authorization, Content-Type,
 * Accept). Заголовки Cloudflare (cf-connecting-ip, cf-ipcountry, x-forwarded-for
 * и т.п.) НЕ пересылаем — иначе Groq видит в них российский IP и отвечает 403.
 *
 * Секретов внутри нет: Groq-ключ приходит в Authorization от бэкенда FeelFilm.
 *
 * Использование на сервере FeelFilm:
 *   GROQ_BASE_URL=https://<имя-воркера>.<субдомен>.workers.dev/openai/v1
 */
export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const target = "https://api.groq.com" + url.pathname + url.search;

    // Только необходимые заголовки — без cf-*/x-forwarded-*, чтобы не выдать РФ.
    const clean = new Headers();
    const auth = request.headers.get("Authorization");
    if (auth) clean.set("Authorization", auth);
    const ct = request.headers.get("Content-Type");
    if (ct) clean.set("Content-Type", ct);
    clean.set("Accept", "application/json");
    clean.set("User-Agent", "FeelFilm-Proxy/1.0");

    const init = {
      method: request.method,
      headers: clean,
      body: (request.method === "GET" || request.method === "HEAD")
        ? undefined
        : await request.arrayBuffer(),
    };

    const upstream = await fetch(target, init);

    const respHeaders = new Headers();
    const upCt = upstream.headers.get("Content-Type");
    if (upCt) respHeaders.set("Content-Type", upCt);
    respHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
