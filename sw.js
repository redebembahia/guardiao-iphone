"use strict";

const CACHE_NAME = "guardiao-iphone-v1.3.0";
const CACHE_PREFIX = "guardiao-iphone-";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./screen-parsers.js",
  "./screenshot-import.js",
  "./maintenance-tools.js",
  "./app.js",
  "./manifest.webmanifest",
  "./PRIVACIDADE.md",
  "./THIRD_PARTY_LICENSES.md",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./vendor/tesseract.min.js",
  "./vendor/worker.min.js",
  "./vendor/tesseract.min.js.LICENSE.txt",
  "./vendor/worker.min.js.LICENSE.txt",
  "./vendor/core/tesseract-core-lstm.wasm.js",
  "./vendor/core/tesseract-core-simd-lstm.wasm.js",
  "./vendor/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "./vendor/lang/por.traineddata.gz"
];
const APP_SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href));
const OFFLINE_INDEX_URL = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const normalizedUrl = new URL(event.request.url);
  normalizedUrl.search = "";
  normalizedUrl.hash = "";
  const cacheKey = normalizedUrl.href;

  // Intercepta somente os arquivos imutáveis do próprio aplicativo. Isso evita
  // que URLs arbitrárias ou variações de consulta ocupem o cache local.
  if (!APP_SHELL_URLS.has(cacheKey)) return;

  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        try {
          const copy = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(cacheKey, copy);
        } catch {
          // A resposta fresca continua válida mesmo se o iOS recusar a gravação por cota.
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        if (event.request.mode === "navigate") return cache.match(OFFLINE_INDEX_URL);
        return new Response("Recurso indisponível offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      })
  );
});
