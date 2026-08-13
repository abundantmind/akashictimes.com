// Akashic Swaps service worker — instant-open + offline shell.
//
// STRATEGY: NETWORK-FIRST for everything, cache as the offline fallback.
// The stale-cache disease is real on this project (sessions 11 + 13 both got
// bitten by browser caches hiding fresh level data) — so the network copy
// always wins when reachable; the cache only answers when the network can't.
// Bump this string on every ship. The activate handler deletes any cache whose
// name != CACHE, so a version bump force-purges every stale cache on the next
// load — the self-heal for the stale-cache disease (sessions 11/13/17 got bitten).
const CACHE = 'akashic-v35';

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
  e.respondWith(
    fetch(req).then(resp => {
      // stash every good same-origin response for offline replay
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return resp;
    }).catch(() => caches.match(req))
  );
});
