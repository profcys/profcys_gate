/**
 * 로컬 개발 서버 — Vite(프런트엔드) + 메모리 게이트웨이 API(/api)
 *
 * 실제 Apps Script 서버 코드(apps-script/gateway-api/*.js)를 Node vm 에서 그대로 실행하고,
 * Firestore·Firebase Auth·CacheService 만 메모리 구현으로 바꿔 끼운다. (Google 계정·과금 불필요)
 *
 *   npm run dev                         → http://localhost:5173
 *   DEV_PORT=5180 DEV_DATA=off npm run dev   (데이터 저장 안 함)
 *   DEV_SETUP_TOKEN=xxxx npm run dev    (최초 설정 토큰 고정 — 자동 테스트용)
 *   DEV_STATIC=dist npm run dev         (빌드 결과물로 실행 — E2E 용)
 *
 * 데이터는 dev/.data/dev-db.json 에 저장된다(.gitignore). 비밀번호는 scrypt 해시로만 저장된다.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadGateway } from './memory-platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.DEV_PORT || 5173);
const persistFile = process.env.DEV_DATA === 'off' ? undefined : path.resolve(process.env.DEV_DATA || path.join(__dirname, '.data/dev-db.json'));
const gw = loadGateway({ persistFile, silent: process.env.DEV_VERBOSE !== '1' });

function ensureSetupToken() {
  const system = gw.platform.store.get('settings', 'system');
  if (system && system.bootstrappedAt) return;
  const token = process.env.DEV_SETUP_TOKEN || crypto.randomBytes(12).toString('hex');
  gw.platform.props.set('SETUP_TOKEN', token);
  gw.platform.props.set('SETUP_TOKEN_EXPIRES', String(Date.now() + 24 * 3600000));
  console.log(`\n  [PROFCYS dev] 최초 설정이 필요합니다. http://localhost:${port}/setup 에서 아래 토큰을 입력하세요.\n\n      ${token}\n`);
}
ensureSetupToken();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 2_000_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }));
    return;
  }
  let text = '';
  try { text = await readBody(req); } catch { res.writeHead(413); res.end(); return; }
  const result = gw.context.handleRequest_(text);
  try { gw.platform.persist(); } catch (e) { console.warn('persist failed', e.message); }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(result));
}

/** 개발용 SSO 검증 시연: /dev/sso-echo 로 POST 된 profcys_code 를 sso.verify 로 검증해 보여준다 */
async function handleSsoEcho(req, res) {
  const text = req.method === 'POST' ? await readBody(req) : '';
  const params = new URLSearchParams(req.method === 'POST' ? text : (req.url.split('?')[1] || ''));
  const code = params.get('profcys_code') || '';
  const serviceId = params.get('sid') || new URLSearchParams(req.url.split('?')[1] || '').get('sid') || '';
  const key = gw.platform.props.get('DEV_SERVICE_KEY_' + serviceId) || '';
  const r = gw.context.handleRequest_(JSON.stringify({ action: 'sso.verify', params: { code, serviceId, serviceKey: key } }));
  gw.platform.persist();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const safe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.end(`<!doctype html><meta charset="utf-8"><title>SSO echo</title><body style="font-family:sans-serif;padding:24px"><h1>개발용 SSO 검증 결과</h1><pre id="result">${safe(JSON.stringify(r, null, 2))}</pre></body>`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain' };

async function start() {
  const staticDir = process.env.DEV_STATIC ? path.resolve(root, process.env.DEV_STATIC) : null;
  let vite = null;
  if (!staticDir) {
    const { createServer } = await import('vite');
    vite = await createServer({ root, server: { middlewareMode: true, hmr: { port: port + 1000 } }, appType: 'spa' });
  }
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    if (url === '/api' || url.startsWith('/api?')) return handleApi(req, res);
    if (url.startsWith('/dev/sso-echo')) return handleSsoEcho(req, res);
    if (vite) return vite.middlewares(req, res);
    // 정적 파일 + SPA 폴백 (firebase.json rewrites 와 동일한 동작)
    const clean = decodeURIComponent(url.split('?')[0]);
    let file = path.join(staticDir, clean);
    if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, () => console.log(`  [PROFCYS dev] http://localhost:${port}  (API: /api, 데이터: ${persistFile || '메모리 전용'})`));
}

start().catch((e) => { console.error(e); process.exit(1); });
