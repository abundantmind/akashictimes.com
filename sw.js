// Akashic Swaps service worker — instant-open + offline shell.
//
// STRATEGY: NETWORK-FIRST for everything, cache as the offline fallback.
// The stale-cache disease is real on this project (sessions 11 + 13 both got
// bitten by browser caches hiding fresh level data) — so the network copy
// always wins when reachable; the cache only answers when the network can't.
// Bump this string on every ship. The activate handler deletes any cache whose
// name != CACHE, so a version bump force-purges every stale cache on the next
// load — the self-heal for the stale-cache disease (sessions 11/13/17 got bitten).
const CACHE = 'akashic-v74';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                    // HEAD (version watchdog) etc: straight through
  if (new URL(req.url).origin !== location.origin) return; // analytics etc: untouched
  // ALWAYS REVALIDATE. GitHub Pages sends `cache-control: max-age=600`, and a plain
  // fetch(req) goes through the browser's HTTP cache — so for 10 minutes after a push
  // "network-first" quietly served the OLD page (Jed 2026-10-03: "it's been pushed"
  // but Hermes still showed the old build, even after the reload toast). cache:'no-cache'
  // asks the server every time; an unchanged file is a cheap 304 via its ETag.
  // A navigation Request can't be cloned with options, so it's re-issued by URL;
  // redirect:'manual' hands any redirect (e.g. /editor → /editor/) back to the browser.
  const fresh = req.mode === 'navigate'
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
    : fetch(new Request(req, { cache: 'no-cache' }));
  e.respondWith(
    fresh.then(resp => {
      // stash every good same-origin response for offline replay
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return resp;
    }).catch(() => caches.match(req))
  );
});
