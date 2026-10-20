// Lets score.html open with no signal. Registered with scope "score.html" only, so no other
// page is ever served from this cache. Network first (so updates show at once), falling back
// to the last copy when the network fails or stalls.

const CACHE = 'daddy-score-v1';
const SHELL = ['score.html', 'css/theme.css', 'js/score.js', 'js/sheet.js', 'js/golf.js', 'js/ui.js', 'favicon.svg'];
const TIMEOUT_MS = 6000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // One missing file shouldn't stop the rest from caching.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('daddy-score-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // score posts go straight to the web app
  const url = new URL(req.url);
  const sheet = url.hostname === 'docs.google.com' && url.pathname.includes('/gviz/');
  if (url.origin !== self.location.origin && !sheet) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req) ?? (req.mode === 'navigate' ? await cache.match('score.html', { ignoreSearch: true }) : null);
    if (hit) return hit;
    throw err;
  }
}
