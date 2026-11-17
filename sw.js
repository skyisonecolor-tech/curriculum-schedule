// 일과 알리미 서비스 워커: 화면 파일만 저장해 두고, 데이터는 항상 서버에서 받습니다.
const CACHE = 'alimi-shell-v8';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'rules.js', 'sel.js', 'block.js', 'blocks.js', 'block-worker.js', 'tt.js', 'ttmodel.js', 'tt-ui.js', 'tt-worker.js', 'ops.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 새 버전을 먼저 받고, 안 되면 저장본 사용
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// 푸시 알림 받기 (Firebase 클라우드 메시징 → 웹 푸시)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { data: { title: '일과 알리미', body: e.data ? e.data.text() : '' } }; }
  const m = Object.assign({}, d.notification || {}, d.data || {});
  const title = m.title || '일과 알리미';
  e.waitUntil(self.registration.showNotification(title, { body: m.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: m.url || './' }, tag: m.tag || undefined }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ type: 'open', url }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
