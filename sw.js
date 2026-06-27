/* Kita & AI — Service Worker v1 */
const CACHE = "kita-ai-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/css/style.css",
  "/js/config.js",
  "/js/app.js",
  "/manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("supabase") || e.request.url.includes("googleapis")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
