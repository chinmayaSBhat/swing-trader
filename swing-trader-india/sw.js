const CACHE_NAME = 'swing-trader-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/js/api.js',
  '/assets/js/storage.js',
  '/assets/js/technical.js',
  '/assets/js/signals.js',
  '/assets/js/utils.js',
  '/assets/js/market-timings.js',
  '/assets/js/alerts.js',
  '/assets/js/charts.js',
  '/assets/js/news.js',
  '/assets/js/watchlist.js',
  '/assets/js/signalsPage.js',
  '/assets/js/market-timings.js',
  '/assets/js/signalWorker.js',
  '/assets/data/nifty500.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request).then(fetchRes => {
      return caches.open(CACHE_NAME).then(cache => {
        cache.put(event.request, fetchRes.clone());
        return fetchRes;
      });
    })).catch(err => {
      console.warn('sw fetch failed', event.request.url, err);
      return caches.match('/index.html');
    })
  );
});

// offline sync queue could be added with Background Sync API
