/* Doğadan Atölye — service worker
   Dosyaları değiştirdiğinizde VERSION değerini artırın (v4 → v5) ki eski önbellek temizlensin.
   Önbellekteki her dosya MAX_AGE süresi dolunca otomatik silinir ve yeniden indirilir. */
const VERSION = "v4";
const CACHE = `dogadan-${VERSION}`;
const META = `dogadan-meta-${VERSION}`;      // her dosyanın önbelleğe alınma zamanı
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;      // 7 gün (ms) — istediğiniz gibi değiştirin
const PURGE_EVERY = 60 * 60 * 1000;           // temizlik kontrolü en çok saatte bir
const OFFLINE_URL = "offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "style.css",
  "pwa-renkler.css",
  "main.js",
  "renkler-data.js",
  "manifest.webmanifest",
  "assets/icons/icon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/hero-mobilya.jpg",
  "assets/galeri-01.jpg",
  "assets/galeri-02.jpg",
  "assets/galeri-03.jpg"
];

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
    if (req.url.endsWith(`/${OFFLINE_URL}`)) return; // çevrimdışı sayfa hep durur
    if ((await ageOf(req.url)) > MAX_AGE) await removeCached(req.url);
  }));
  // Çevrimdışı sayfayı da süresi dolunca tazele
  if ((await ageOf(new URL(OFFLINE_URL, self.location).href)) > MAX_AGE) {
    try { await cache.add(OFFLINE_URL); await stamp(new URL(OFFLINE_URL, self.location).href); } catch (e) {}
  }
}

/* ─── Yaşam döngüsü ─── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Eksik bir dosya tüm kurulumu bozmasın diye tek tek eklenir
      Promise.all(PRECACHE.map(async (url) => {
        try {
          await cache.add(url);
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
        keys.filter((k) => k.startsWith("dogadan-") && k !== CACHE && k !== META).map((k) => caches.delete(k))
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

  // Google Fonts: süresi dolmadıysa önbellekten, yoksa ağdan
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (url.origin !== location.origin) return;

  // Sayfalar: bağlantı yoksa "Bağlantı yok" sayfasını göster
  if (req.mode === "navigate") {
    event.waitUntil(purgeExpired());
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Diğer dosyalar: süresi dolmadıysa önbellekten, yoksa ağdan
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    if ((await ageOf(req.url)) <= MAX_AGE) return cached;
    await removeCached(req.url); // süresi dolmuş: sil, yenisini indir
  }
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    await putCached(req, res.clone());
  }
  return res;
}