// Работа без сети: страница заявителя и страница статуса открываются из сохранённой копии,
// когда интернета нет (подвалы и лаборатории колледжа).
// Всегда сначала сеть: при обычной связи человек видит свежую версию, копия нужна только без сети.
// Панель УПК, коды отслеживания (/t/...) и закрытые запросы к API не сохраняются.

const VERSION = "upk-offline-v3";
const NETWORK_WAIT = 4000; // столько ждём сеть, потом отдаём сохранённую копию

const SHELL = [
  "/",
  "/track",
  "/privacy",
  "/manifest.webmanifest",
  // открытые справочники: без сети можно выбрать помещение и увидеть последнее состояние колледжа
  "/api/meta",
  "/api/locations",
  "/api/campus",
  "/static/css/fonts.css",
  "/static/css/app.css",
  "/static/css/ambient.css",
  "/static/css/campus.css",
  "/static/css/motion.css",
  "/static/js/boot.js",
  "/static/js/core.js",
  "/static/js/select.js",
  "/static/js/motion.js",
  "/static/js/ambient.js",
  "/static/js/intro.js",
  "/static/js/brand.js",
  "/static/js/campus.js",
  "/static/js/cursor.js",
  "/static/js/plan.js",
  "/static/js/floor-view.js",
  "/static/js/report.js",
  "/static/js/track.js",
  "/static/js/page.js",
  "/static/img/icon.svg",
  "/static/img/mark.svg",
  "/static/img/lockup.svg",
  "/static/fonts/inter-400-cyr.woff2",
  "/static/fonts/inter-400-lat.woff2",
  "/static/fonts/inter-500-cyr.woff2",
  "/static/fonts/inter-600-cyr.woff2",
  "/static/fonts/inter-700-cyr.woff2",
];

// открытые данные, которые нужны странице заявителя: последняя копия лучше пустой страницы
const PUBLIC_API = /^\/api\/(meta|campus|locations(\/qr\/[^/]+)?)$/;
const SKIP = /^\/(admin|t\/|api\/|sw\.js)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // один недоступный файл не должен ломать установку остальных
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request, cacheKey) {
  return new Promise((resolve) => {
    let done = false;
    const fromCache = () =>
      caches.match(cacheKey || request).then((hit) => hit || (request.mode === "navigate" ? caches.match("/") : null));
    const timer = setTimeout(() => {
      fromCache().then((hit) => {
        if (hit && !done) {
          done = true;
          resolve(hit);
        }
      });
    }, NETWORK_WAIT);
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(cacheKey || request, copy));
        }
        clearTimeout(timer);
        if (!done) {
          done = true;
          resolve(response);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => {
          if (done) return;
          done = true;
          resolve(hit || Response.error());
        });
      });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (PUBLIC_API.test(path)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (SKIP.test(path)) return;
  if (request.mode === "navigate") {
    // страница сохраняется без параметров адреса
    event.respondWith(networkFirst(request, path));
    return;
  }
  if (path.startsWith("/static/") || path === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
  }
});
