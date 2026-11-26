/**
 * PROFCYS 서비스 워커 (27장)
 * - 해시가 붙은 정적 리소스(/assets/*)와 아이콘만 캐시한다.
 * - API 응답, 인증 정보, 사용자 데이터, HTML 은 캐시하지 않는다 (공용 PC 에서 로그아웃 후 정보 잔존 방지).
 * - HTML 은 항상 네트워크에서 받고, 오프라인일 때만 간단한 안내 페이지를 보여 준다.
 */
const VERSION = 'profcys-static-v1';
const OFFLINE_HTML = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>오프라인 - PROFCYS</title>' +
  '<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#F5F7FB;color:#102B50;text-align:center;padding:16px">' +
  '<div><h1 style="font-size:20px">네트워크에 연결되어 있지 않습니다</h1><p>연결을 확인한 뒤 다시 시도하세요.</p><button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:0;background:#2563EB;color:#fff;font-size:15px">다시 시도</button></div></body></html>';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/icons/favicon.svg', '/icons/icon-192.png', '/manifest.webmanifest'])).catch(() => undefined));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // API(POST)는 절대 가로채지 않음
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Apps Script·Firestore·폰트 등 외부 요청은 관여하지 않음
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
