// Service worker: guarda o app no aparelho para abrir sem internet. Não intercepta chamadas externas.
const VERSION = "carmonitor-v65";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "core/catalog.js", "core/classify.js", "core/score.js", "core/dedup.js", "core/distance.js", "core/engine.js", "core/equipment.js",
  "core/parsing.js", "core/route.js", "core/specs.js", "core/store.js", "core/textnorm.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // rede primeiro (sempre a versão mais nova do app e da pesquisa); cache só quando estiver sem internet
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => { // sempre revalida (evita misturar versões)
    if (res.ok && e.request.mode !== "navigate" && !url.pathname.includes("/data/")) {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data?.listing;
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    if (cs[0]) return cs[0].focus();
    return self.clients.openWindow(id ? `./#listing=${id}` : "./");
  }));
});
