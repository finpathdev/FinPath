// FinPath Service Worker — cache finpath-v56
// Handles offline caching so lessons and the shell keep working with no signal.
// Live prices, filings, and API responses are intentionally NOT cached — those
// must always be fresh.

const CACHE = 'finpath-v56';
const scope = new URL(self.registration.scope);
const shellPage = new URL('index.html', scope);
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './data/life-assumptions.v1.json',
  './js/intel/life/engine.js',
  './js/intel/life/presets.js',
  './js/intel/life/compare.js',
  './js/intel/life/journal.js',
  './js/intel/life/review.js',
  './js/intel/life/future.js',
  './js/intel/life/sync.js',
  './js/intel/life/boot.js',
  './js/intel/learn/concepts.js',
  './js/intel/learn/progress.js',
  './js/intel/learn/quizlog.js',
  './js/intel/learn/mastery.js',
  './js/intel/learn/plan.js',
  './js/intel/identity/profiles.js',
  './js/intel/identity/boot.js',
  './js/market/candles.js',
  './js/market/risk.js',
  './js/market/quotes.js',
  './js/intel/paper/thesis.js',
  './js/intel/paper/patterns.js',
  './js/intel/paper/boot.js',
  './js/intel/sync/merge.js',
  './js/intel/sync/boot.js',
  './js/intel/study/efficacy.js',
  './js/intel/study/boot.js',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icon-180.png',
  './logo-mark.png'
];

// Install: precache the app shell.
self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE)
      .then(function(cache){ return cache.addAll(SHELL.map(function(path){ return new Request(new URL(path, scope), {cache:'reload'}); })); })
      .then(function(){ return self.skipWaiting(); })
  );
});

// Allow the page to force an immediate takeover when a new SW is ready.
self.addEventListener('message', function(event){
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Activate: clean out old cache versions on new deploys.
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return /^finpath-v\d+$/.test(k) && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Only app entry URLs use the cached homepage as an offline fallback.
function isAppPage(url){
  return url.origin === scope.origin &&
    (url.pathname === scope.pathname || url.pathname === shellPage.pathname);
}

const SHELL_ASSETS = new Set(SHELL.map(function(path){ return new URL(path, scope).href; }));
const OFFLINE = {status: 504, statusText: 'Offline'};

async function serveAppPage(req){
  const cache = await caches.open(CACHE).catch(function(){ return null; });
  try{
    const res = await fetch(req);
    if(cache && res.ok && !res.redirected && (res.headers.get('content-type') || '').includes('text/html')){
      await cache.put(shellPage, res.clone()).catch(function(){});
    }
    return res;
  }catch(e){
    const saved = cache && await cache.match(shellPage).catch(function(){ return null; });
    return saved || new Response('FinPath is unavailable offline.', OFFLINE);
  }
}

async function serveShellAsset(req){
  const cache = await caches.open(CACHE).catch(function(){ return null; });
  const saved = cache && await cache.match(req).catch(function(){ return null; });
  return saved || fetch(req);
}

self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(req.mode === 'navigate'){
    if(isAppPage(url)) event.respondWith(serveAppPage(req));
    return;
  }
  if(SHELL_ASSETS.has(url.href)) event.respondWith(serveShellAsset(req));
});
