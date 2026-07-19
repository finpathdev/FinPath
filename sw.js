// FinPath Service Worker
// Handles offline caching so lessons and the shell keep working with no signal.
// Live prices, filings, and API responses are intentionally NOT cached — those
// must always be fresh.

const CACHE = 'finpath-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './og-image.png'
];

// Install: precache the app shell.
self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE)
      .then(function(cache){ return cache.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

// Activate: clean out old cache versions on new deploys.
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Fetch strategy:
//  - Live-data APIs → always go to network (never serve stale prices).
//  - Everything else → try cache first for speed, fall back to network.
//  - Full network fail → fall back to the cached homepage so the app still opens.
self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  const alwaysNetwork = [
    'finnhub.io',
    'supabase.co',
    'stripe.com',
    'sec.gov',
    'openai.com',
    'anthropic.com',
    'api.',
    'plausible.io'
  ];
  if(alwaysNetwork.some(function(host){ return url.hostname.indexOf(host) !== -1; })){
    return;   // let the browser handle it normally, no caching
  }

  event.respondWith(
    // Network-first for HTML navigations — this way, any HTML update we push
    // deploys instantly for existing users instead of being trapped in cache.
    // We only fall back to cache when the network fails (true offline mode).
    req.mode === 'navigate' || (req.headers.get('accept')||'').indexOf('text/html') !== -1
      ? fetch(req).then(function(res){
          if(res && res.ok){
            const clone = res.clone();
            caches.open(CACHE).then(function(cache){ cache.put(req, clone); });
          }
          return res;
        }).catch(function(){ return caches.match('./index.html').then(function(m){ return m || caches.match('./'); }); })
      : caches.match(req).then(function(cached){
      if(cached) return cached;
      return fetch(req).then(function(res){
        // opportunistically cache successful same-origin GETs (fonts, images, etc.)
        if(res && res.ok && res.type === 'basic'){
          const clone = res.clone();
          caches.open(CACHE).then(function(cache){ cache.put(req, clone); });
        }
        return res;
      }).catch(function(){
        if(req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', {status: 504, statusText: 'Offline'});
      });
    })
  );
});
