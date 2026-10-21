const VERSION = "v13";
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

/* ─── Önbellek yardımcıları ─── */
/* caches.match tüm önbelleklerde arar; META önbelleği de (zaman damgaları) aranırdı.
   Yalnızca ana önbellekte ara. */
async function cacheMatch(req, opts) {
  const cache = await caches.open(CACHE);
  return cache.match(req, opts);
}

async function stamp(url) {
  const meta = await caches.open(META);
  await meta.put(url, new Response(String(Date.now())));
}
async function ageOf(url) {
  const meta = await caches.open(META);
  const res = await meta.match(url);
  return res ? Date.now() - Number(await res.text()) : Infinity;
}

/* Önbelleğe yazma hiçbir zaman yanıtı bozmasın (kota dolu, 206 kısmi yanıt vb.) */
async function putCached(req, res) {
  try {
    const cacheable = res && (res.status === 200 || res.type === "opaque");
    if (!cacheable) return;
    const cache = await caches.open(CACHE);
    await cache.put(req, res);
    await stamp(req.url);
  } catch (e) {
    /* yoksay */
  }
}
async function removeCached(url) {
  const cache = await caches.open(CACHE);
  const meta = await caches.open(META);
  await Promise.all([cache.delete(url), meta.delete(url)]);
}

/* Yönlendirilmiş (redirected) yanıt, sayfa isteğine olduğu gibi verilirse tarayıcı hata verir */
async function cleanRedirect(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

let lastPurge = 0;
async function purgeExpired(force = false) {
  /* Çevrimdışıyken silme: kullanıcı görselleri kaybederdi */
  if (self.navigator && self.navigator.onLine === false) return;
  if (!force && Date.now() - lastPurge < PURGE_EVERY) return;
  lastPurge = Date.now();
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.map(async (req) => {
    const url = new URL(req.url);
    if (isShell(url)) return; // uygulama kabuğu (offline.html dahil) silinmez
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
        } catch (e) {
          console.warn("[SW] Önbelleğe alınamadı:", url);
        }
      }))
    )
    /* skipWaiting burada YOK: kullanıcı "Yenile"ye basınca message ile çağrılır */
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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

  // Range istekleri (video/ses) 206 döner ve önbelleğe yazılamaz: karışma
  if (req.headers.has("range")) return;

  // Video dosyalarını önbelleğe alma (büyük)
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return;

  // Google Fonts
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(event, req));
    return;
  }

  if (url.origin !== location.origin) return;

  // Sayfalar: ağ → önbellek → ana sayfa → "Bağlantı yok"
  if (req.mode === "navigate") {
    event.waitUntil(purgeExpired());
    event.respondWith(navigate(event, req));
    return;
  }

  // CSS / JS / manifest: ağ → önbellek
  if (isShell(url)) {
    event.respondWith(networkFirst(event, req).catch(() => Response.error()));
    return;
  }

  // Görseller vb.: önbellek → ağ
  event.respondWith(cacheFirst(event, req));
});

async function navigate(event, req) {
  try {
    return await cleanRedirect(await networkFirst(event, req));
  } catch (e) {
    const url = new URL(req.url);
    const home = url.pathname.endsWith("/") ? await cacheMatch("index.html") : null;
    const fallback = home || (await cacheMatch(OFFLINE_URL));
    return fallback ? cleanRedirect(fallback) : Response.error();
  }
}

async function networkFirst(event, req) {
  const cached = await cacheMatch(req, { ignoreSearch: true });

  let cacheTask = Promise.resolve();
  const net = fetch(req).then((res) => {
    if (res.ok && res.type === "basic" && !res.redirected) {
      cacheTask = putCached(req, res.clone());
    }
    return res;
  });
  /* Ağ cevabı zaman aşımından sonra gelse bile önbellek güncellensin, SW erken kapanmasın */
  event.waitUntil(net.then(() => cacheTask, () => {}));

  try {
    if (!cached) return await net;
    return await Promise.race([
      net,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), NETWORK_TIMEOUT))
    ]);
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(event, req) {
  const cached = await cacheMatch(req);
  if (cached && (await ageOf(req.url)) <= MAX_AGE) return cached;

  try {
    const res = await fetch(req);
    if (cached && res.status === 404) {
      event.waitUntil(removeCached(req.url)); // sunucudan silinmiş
    } else {
      event.waitUntil(putCached(req, res.clone()));
    }
    return res;
  } catch (err) {
    /* Süresi dolmuş olsa bile çevrimdışıyken eldekini göster */
    if (cached) return cached;
    throw err;
  }
}
