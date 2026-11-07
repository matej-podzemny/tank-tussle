// Tank Tussle service worker: caches the app shell so local play works offline.
// - HTML pages and config.js: network first (fresh when online), cached copy when offline.
// - Other shell files (JS, icons, manifest): from the cache, refreshed whenever VERSION changes.
// - Never touches the online-play server: WebSocket (/ws), /health, other origins or non-GET requests pass straight through.
// VERSION is stamped by build.py (hash of the shell files), so every rebuild installs a fresh cache.
const VERSION = '63237b91ac';
const CACHE = 'tank-tussle-' + VERSION;
const SHELL = ['./', 'index.html', 'config.js', 'game.js', 'bots.js', 'client.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg'];
const NETWORK_FIRST = /(\/|\.html|config\.js)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => r.ok && c.put(u, r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('tank-tussle-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;              // other servers (game server API) untouched
  if (/\/(ws|health)$/.test(url.pathname) || req.headers.get('upgrade')) return;    // never the WebSocket / server API
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const key = url.pathname === scope.pathname ? './' : url.pathname.slice(scope.pathname.length);
  if (req.mode === 'navigate' || NETWORK_FIRST.test(url.pathname)) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? './' : key, copy)); } return r; })
      .catch(() => caches.match(req.mode === 'navigate' ? './' : key, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(key, { ignoreSearch: true }).then(r => r || fetch(req)));
});
