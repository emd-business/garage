// App-shell cache. Data requests (Supabase) always go to the network.
const VERSION = 'emd-garage-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/api.js', 'js/format.js', 'js/ui.js', 'js/state.js',
  'js/views/dashboard.js', 'js/views/board.js', 'js/views/intake.js', 'js/views/job.js', 'js/views/print.js',
  'js/views/customers.js', 'js/views/inventory.js', 'js/views/settings.js',
  'assets/logo.svg', 'assets/logo-on-dark.svg', 'assets/icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first, cache as fallback so updates reach users immediately
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
