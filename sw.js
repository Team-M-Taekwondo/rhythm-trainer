/* ============================================================
   MTEAM Tempo Trainer — offline support (service worker)
   Keeps the app and every recording on the phone after one visit, so it
   works with no signal (gym, abroad) and doesn't re-download the audio.

   - Recordings (audio/…): served from the phone right away. In the
     background it asks GitHub "has this file changed?" (a tiny request when
     it hasn't), so a republished clip shows up on the next open.
   - Scripts/CSS with ?v=: same idea, keyed by version — a ?v= bump is a
     new file.
   - Everything else (index.html, data/*.json): network first so updates
     land right away, falling back to the phone's copy when the network
     is slow (4s) or gone.
   ============================================================ */
const CACHE = "mteam-rhythm-v1"; // must match MT.OFFLINE_CACHE in js/audio.js
const SLOW_NETWORK_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.indexOf("mteam-rhythm-") === 0 && n !== CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// One cache entry per file: data/*.json drop their ?ts= cache-buster, and
// every way of opening the app (/, ?admin=1, …) is the same index.html.
function cacheKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete("ts");
  if (request.mode === "navigate" || url.pathname.endsWith("/")) {
    url.search = "";
    if (url.pathname.endsWith("/")) url.pathname += "index.html";
  }
  if (!url.searchParams.toString()) url.search = "";
  url.hash = "";
  return url.href;
}

function isAudio(url) {
  return /\/audio\//.test(url.pathname) && /\.(mp3|m4a|aac|wav|ogg)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = cacheKey(req);
  if (isAudio(url)) event.respondWith(cacheFirst(event, req, key, false));
  else if (url.searchParams.has("v")) event.respondWith(cacheFirst(event, req, key, true));
  else event.respondWith(networkFirst(event, req, key));
});

async function cacheFirst(event, req, key, versioned) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) {
    event.waitUntil(revalidate(cache, key, hit));
    return hit;
  }
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    event.waitUntil(
      cache
        .put(key, copy)
        .then(() => versioned && prune(cache, key))
        .catch(() => {})
    );
  }
  return res;
}

// Conditional re-check: GitHub answers 304 (no body) when the file is the
// same, so this costs almost nothing on a slow connection.
async function revalidate(cache, key, hit) {
  const headers = {};
  const etag = hit.headers.get("ETag");
  const lastMod = hit.headers.get("Last-Modified");
  if (etag) headers["If-None-Match"] = etag;
  else if (lastMod) headers["If-Modified-Since"] = lastMod;
  else return;
  try {
    const res = await fetch(key, { headers, cache: "no-store" });
    if (res.status === 200 && res.type === "basic") await cache.put(key, res);
  } catch (e) {}
}

// A new ?v= of a script/stylesheet replaces the old one.
async function prune(cache, key) {
  const path = new URL(key).pathname;
  const keys = await cache.keys();
  await Promise.all(
    keys.filter((r) => r.url !== key && new URL(r.url).pathname === path).map((r) => cache.delete(r))
  );
}

function networkFirst(event, req, key) {
  const cacheP = caches.open(CACHE);
  const netP = fetch(req);
  // Clone before the page starts reading the body.
  event.waitUntil(
    netP
      .then((res) => {
        if (!res.ok || res.type !== "basic") return;
        const copy = res.clone();
        return cacheP.then((c) => c.put(key, copy));
      })
      .catch(() => {})
  );
  const cachedP = cacheP.then((c) => c.match(key));
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (settled || !r) return;
      settled = true;
      resolve(r);
    };
    netP.then(
      (res) => (res.ok ? done(res) : cachedP.then((c) => done(c || res))),
      async () => {
        const c = (await cachedP) || (await (await cacheP).match(key, { ignoreSearch: true }));
        done(c || Response.error());
      }
    );
    setTimeout(() => cachedP.then(done), SLOW_NETWORK_MS);
  });
}
