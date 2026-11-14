/* مساعد التداول — يحفظ ملفات التطبيق على الجهاز ليعمل دون إنترنت.
   يعرض النسخة المحفوظة فوراً ويجلب الأحدث في الخلفية، فيظهر أي تعديل عند الفتح التالي
   دون الحاجة لتغيير رقم الإصدار. طلبات الأسعار تذهب للشبكة مباشرة ولا تُحفظ هنا. */
const CACHE = 'trading-assistant-v1';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './core.js',
  './charts.js',
  './app.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('trading-assistant-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(key, { ignoreSearch: true }).then((cached) => {
        const fresh = fetch(req).then((res) => {
          if (res && res.ok && !res.redirected) cache.put(key, res.clone());
          return res;
        });
        if (!cached) return fresh;
        event.waitUntil(fresh.catch(() => {}));
        return cached;
      })
    )
  );
});
