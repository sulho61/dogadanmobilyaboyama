const VERSION = "v5";
const CACHE = `lazvegaz-${VERSION}`;
const META = `lazvegaz-meta-${VERSION}`;      // her dosyanın önbelleğe alınma zamanı
const MAX_AGE = 2 * 24 * 60 * 60 * 1000;      // 2 gün — yalnızca görsel/font gibi dosyalar için
const PURGE_EVERY = 60 * 60 * 1000;           // temizlik kontrolü en çok saatte bir
const NETWORK_TIMEOUT = 5000;                 // önbellek varsa ağı en fazla 5 sn bekle
const OFFLINE_URL = "offline.html";

const PRECACHE = [
  "./",
  "index.html",
  "gallery.html",
  "renkler.html",
  OFFLINE_URL,
  "style.css",
  "pwa-renkler.css",
  "mobile.css",
  "main.js",
  "renkler-data.js",
  "manifest.webmanifest",
  "assets/icons/icon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/hero-mobilya.jpg",
  "assets/galeri-01.jpg",
  "assets/galeri-02.jpg",
  "assets/galeri-03.jpg"
];

/* Sayfa, CSS, JS: her zaman önce ağdan (güncel kalsın), ağ yoksa önbellekten */
function isShell(url) {
  const p = url.pathname;
  return p.endsWith("/") || /\.(html|css|js|webmanifest)$/i.test(p);
}

/* ─── Zaman damgası + süre dolumu ─── */
async function stamp(url) {
  const meta = await caches.open(META);
  await meta.put(url, new Response(String(Date.now())));
}
async function ageOf(url) {
  const meta = await caches.open(META);
  const res = await meta.match(url);
  return res ? Date.now() - Number(await res.text()) : Infinity;
}
async function putCached(req, res) {
  const cache = await caches.open(CACHE);
  await cache.put(req, res);
  await stamp(req.url);
}
async function removeCached(url) {
  const cache = await caches.open(CACHE);
  const meta = await caches.open(META);
  await Promise.all([cache.delete(url), meta.delete(url)]);
}

let lastPurge = 0;
async function purgeExpired(force = false) {
  if (!force && Date.now() - lastPurge < PURGE_EVERY) return;
  lastPurge = Date.now();
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.map(async (req) => {
    const url = new URL(req.url);
    if (isShell(url) || url.pathname.endsWith(`/${OFFLINE_URL}`)) return; // uygulama kabuğu silinmez
    if ((await ageOf(req.url)) > MAX_AGE) await removeCached(req.url);
  }));
}

/* ─── Yaşam döngüsü ─── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map(async (url) => {
        try {
          await cache.add(new Request(url, { cache: "reload" }));
          await stamp(new URL(url, self.location).href);
        } catch (e) {}
      }))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("lazvegaz-") && k !== CACHE && k !== META).map((k) => caches.delete(k))
      ))
      .then(() => purgeExpired(true))
      .then(() => self.clients.claim())
  );
});

/* ─── İstekler ─── */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Video dosyalarını önbelleğe alma (büyük + range isteği)
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return;

  // Google Fonts
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (url.origin !== location.origin) return;

  // Sayfalar: ağ → önbellek → ana sayfa → "Bağlantı yok"
  if (req.mode === "navigate") {
    event.waitUntil(purgeExpired());
    event.respondWith(navigate(req));
    return;
  }

  // CSS / JS / manifest: ağ → önbellek
  if (isShell(url)) {
    event.respondWith(networkFirst(req).catch(() => Response.error()));
    return;
  }

  // Görseller vb.: önbellek → ağ
  event.respondWith(cacheFirst(req));
});

async function navigate(req) {
  try {
    return await networkFirst(req);
  } catch (e) {
    const url = new URL(req.url);
    const home = url.pathname.endsWith("/") ? await caches.match("index.html") : null;
    return home || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function networkFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  try {
    const net = fetch(req);
    const res = cached
      ? await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), NETWORK_TIMEOUT))])
      : await net;
    if (res && res.ok && res.type === "basic" && !res.redirected) {
      putCached(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    if ((await ageOf(req.url)) <= MAX_AGE) return cached;
    await removeCached(req.url);
  }
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    await putCached(req, res.clone());
  }
  return res;
}
