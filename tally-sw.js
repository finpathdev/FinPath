/* Tally service worker.
 *
 * - Precaches the whole app at install, so it opens offline from the first
 *   launch after installing. The file list and version are injected at build
 *   time by the `precache` plugin in vite.config.ts.
 * - Pages: network first (deploys show up), cached shell when offline.
 * - Hashed assets: cache first.
 * - A new version waits until the app asks it to take over, so an update
 *   never swaps code under someone mid-edit. The app shows a "Reload" toast.
 * - Only same-origin GETs are handled; GitHub API and FX requests always go
 *   to the network. The one exception is the receipt reader: its pinned,
 *   versioned files from jsDelivr are cached after the first scan so
 *   scanning also works offline. No photo or personal data is ever sent.
 */
const VERSION = 'c04f754cfd04';
const PRECACHE = ["./tally-apple-touch-icon.png","./tally-gloock.woff2","./tally-hanken-grotesk.woff2","./tally-icon-192.png","./tally-icon-512.png","./tally-icon-maskable-512.png","./tally-icon.svg","./tally-manifest.webmanifest","./tally-martian-mono.woff2"];
const CACHE = `tally-${VERSION}`;
// Kept across app updates: the files are versioned in their URLs.
const OCR_CACHE = 'ocr-v1';
const OCR_FILES = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js@|tesseract\.js-core@|@tesseract\.js-data\/)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...PRECACHE])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tally-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'GET' && OCR_FILES.test(req.url)) {
    event.respondWith(
      caches.open(OCR_CACHE).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res.ok) c.put(req, res.clone());
          return res;
        })),
      ),
    );
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// ---------- reminders (see src/ui/reminders.ts) ----------
// The app stores a precomputed schedule in IndexedDB, so this only compares
// dates. Runs on Periodic Background Sync (installed app in Chrome/Edge).

function kv(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('tally', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const result = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
    };
  });
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkReminders() {
  const enabled = await kv('readonly', (s) => s.get('enabled'));
  if (!enabled || self.Notification?.permission !== 'granted') return;
  const schedule = (await kv('readonly', (s) => s.get('schedule'))) || [];
  const shown = new Set((await kv('readonly', (s) => s.get('notified'))) || []);
  const on = localToday();
  const due = schedule.filter((r) => r.notifyOn <= on && r.date >= on && !shown.has(r.key));
  for (const r of due) {
    await self.registration.showNotification(r.title, {
      body: r.body,
      tag: r.key,
      icon: 'tally-icon-192.png',
      badge: 'tally-icon-192.png',
      data: { url: './#/subscriptions' },
    });
    shown.add(r.key);
  }
  if (due.length) {
    const live = new Set(schedule.filter((r) => r.date >= on).map((r) => r.key));
    await kv('readwrite', (s) => s.put([...shown].filter((k) => live.has(k)), 'notified'));
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tally-reminders') event.waitUntil(checkReminders());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (existing) return existing.focus().then((c) => c.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});
