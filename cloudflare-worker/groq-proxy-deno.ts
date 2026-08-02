/**
 * FeelFilm — прокси к Groq через Deno Deploy.
 *
 * Зачем: сервер FeelFilm в РФ, а Groq (api.groq.com) блокирует российские IP.
 * Deno Deploy работает на глобальной инфраструктуре (не РФ) и Groq его не режет.
 *
 * ВАЖНО: в Groq пересылаем только чистые заголовки (Authorization, Content-Type,
 * Accept). Ничего своего/палящего не добавляем.
 *
 * Секретов внутри нет: Groq-ключ приходит в Authorization от бэкенда FeelFilm.
 *
 * Использование: GROQ_BASE_URL=https://<имя>.deno.net/openai/v1
 */
Deno.serve(async (request: Request) => {
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

  const clean = new Headers();
  const auth = request.headers.get("Authorization");
  if (auth) clean.set("Authorization", auth);
  const ct = request.headers.get("Content-Type");
  if (ct) clean.set("Content-Type", ct);
  clean.set("Accept", "application/json");
  clean.set("User-Agent", "FeelFilm-Proxy/1.0");

  const body = (request.method === "GET" || request.method === "HEAD")
    ? undefined
    : await request.arrayBuffer();

  const upstream = await fetch(target, { method: request.method, headers: clean, body });

  const respHeaders = new Headers();
  const upCt = upstream.headers.get("Content-Type");
  if (upCt) respHeaders.set("Content-Type", upCt);
  respHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
});
