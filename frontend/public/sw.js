const CACHE = "oece-x-shell-v2";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/192.png", "/icons/512.png"];

function bypass(url) {
  const p = url.pathname;
  return (
    p.startsWith("/api/") ||
    p.startsWith("/src") ||
    p.startsWith("/@") ||
    p.includes("vite")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (bypass(url)) return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html")),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
