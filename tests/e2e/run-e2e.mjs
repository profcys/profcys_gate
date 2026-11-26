/**
 * E2E 테스트 (Playwright, 실제 브라우저) — 빌드 결과물(dist) + 로컬 게이트웨이(메모리 DB)
 *
 *   npm run build && npm run test:e2e
 *
 * 결과: test-results/e2e/report.json, 스크린샷 test-results/e2e/*.png
 * 각 시나리오는 PASS/FAIL 로만 기록하며, 실행하지 못한 항목은 기록하지 않는다(보고서에서 NOT TESTED 로 표기).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'test-results/e2e');
fs.mkdirSync(out, { recursive: true });
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'e2e-setup-token-0001';
const INIT_PW = 'Init!Passw0rd#E2E';
const ADMIN_PW = 'Adm1n!Secure#E2E';
const USER_PW = 'User!Passw0rd#E2E';
const results = [];
const shotPages = [];

if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  console.error('dist 가 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(2);
}

const server = spawn(process.execPath, ['dev/dev-server.mjs'], {
  cwd: root, env: { ...process.env, DEV_PORT: String(PORT), DEV_DATA: 'off', DEV_STATIC: 'dist', DEV_SETUP_TOKEN: SETUP_TOKEN }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server start timeout')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(`localhost:${PORT}`)) { clearTimeout(t); resolve(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

console.log('server up');
const browser = await chromium.launch();
console.log('browser up');

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, result: 'PASS', ms: Date.now() - started });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, result: 'FAIL', ms: Date.now() - started, error: String(e && e.message || e).slice(0, 500) });
    for (const [i, p] of shotPages.entries()) await p.screenshot({ path: path.join(out, `fail-${results.length}-${i}.png`) }).catch(() => undefined);
    console.log('FAIL', name, '\n   ', String(e && e.message || e).split('\n')[0]);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function noHorizontalScroll(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(r.sw <= r.cw + 1, `${label}: 가로 스크롤 발생 (scrollWidth ${r.sw} > ${r.cw})`);
}

async function login(page, username, password) {
  await page.goto(BASE + '/login');
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
}

async function changePassword(page, current, next) {
  await page.waitForURL('**/account/password');
  await page.getByLabel(/현재\) 비밀번호|현재 비밀번호/).fill(current);
  await page.getByLabel('새 비밀번호', { exact: true }).fill(next);
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill(next);
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/account/password'), { timeout: 15000 });
}

const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
admin.setDefaultTimeout(15000);
const ap = await admin.newPage();
shotPages.push(ap);
const consoleErrors = [];
ap.on('pageerror', (e) => consoleErrors.push(String(e)));
let tempPassword = '';
let serviceId = '';

await step('로그인 화면 표시 (회원가입 링크 없음, 모바일 가로 스크롤 없음)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  await p.getByRole('button', { name: '로그인' }).waitFor();
  assert(!(await p.getByText('회원가입').count()), '회원가입 문구가 존재함');
  await noHorizontalScroll(p, '로그인(390px)');
  await p.screenshot({ path: path.join(out, 'login-mobile.png') });
  await ctx.close();
});

await step('미인증 사용자의 보호 경로 접근 → 로그인 화면으로 이동', async () => {
  await ap.goto(BASE + '/admin/users');
  await ap.waitForURL('**/login');
});

await step('최초 설정: 토큰으로 profcys 비밀번호 지정 → 로그인 → 비밀번호 변경 강제', async () => {
  await ap.goto(BASE + '/setup');
  await ap.getByLabel('설정 토큰').fill(SETUP_TOKEN);
  await ap.getByLabel('관리자 비밀번호', { exact: true }).fill(INIT_PW);
  await ap.getByLabel('비밀번호 확인', { exact: true }).fill(INIT_PW);
  await ap.getByRole('button', { name: '최고관리자 생성' }).click();
  await ap.getByRole('link', { name: '로그인하러 가기' }).click();
  await ap.waitForURL('**/login', { timeout: 15000 });
  await login(ap, 'profcys', INIT_PW);
  await changePassword(ap, INIT_PW, ADMIN_PW);
});

await step('관리자: 업무 서비스 간편 등록 → 초안 상태', async () => {
  await ap.goto(BASE + '/admin/services');
  await ap.getByRole('button', { name: '간편 등록' }).click();
  const dlg = ap.getByRole('dialog');
  await dlg.getByLabel('서비스 명칭').fill('E2E 보고서 도우미');
  await dlg.getByLabel('서비스 연결 URL').fill('https://e2e-report.web.app');
  await dlg.getByText('형식 검증 통과').waitFor({ timeout: 10000 });
  await dlg.getByRole('button', { name: '초안으로 등록' }).click();
  await dlg.waitFor({ state: 'detached' });
  const row = ap.getByRole('row', { name: /E2E 보고서 도우미/ });
  await row.waitFor();
  assert(await row.getByText('등록 초안').count(), '초안 상태가 아님');
  serviceId = (await row.locator('.mono').first().innerText()).split('·')[0].trim();
  await ap.screenshot({ path: path.join(out, 'admin-services.png') });
});

await step('관리자: 위험 URL(javascript:, 내부 IP) 등록 차단', async () => {
  await ap.getByRole('button', { name: '간편 등록' }).click();
  const dlg = ap.getByRole('dialog');
  await dlg.getByLabel('서비스 연결 URL').fill('https://127.0.0.1/admin');
  await dlg.getByText('등록 불가').waitFor({ timeout: 10000 });
  await dlg.getByLabel('서비스 연결 URL').fill('javascript:alert(1)');
  await dlg.getByText('등록 불가').waitFor({ timeout: 10000 });
  await dlg.getByRole('button', { name: '취소' }).click();
});

await step('관리자: 공개 승인 (승인 체크 없이는 버튼 비활성)', async () => {
  const row = ap.getByRole('row', { name: /E2E 보고서 도우미/ });
  await row.getByRole('button', { name: /상태 변경/ }).click();
  const dlg = ap.getByRole('dialog');
  const btn = dlg.getByRole('button', { name: '변경' });
  assert(await btn.isDisabled(), '승인 체크 전 버튼이 활성 상태');
  await dlg.getByText('공개를 승인합니다').click();
  await btn.click();
  await dlg.waitFor({ state: 'detached' });
  await row.getByText('공개', { exact: true }).waitFor();
});

await step('관리자: 신규 사용자 등록 (새 서비스 체크박스 자동 표시, 임시 비밀번호 1회 표시)', async () => {
  await ap.goto(BASE + '/admin/users/new');
  const dlg = ap.getByRole('dialog');
  await dlg.getByLabel('사용자 이름').fill('김테스트');
  await dlg.getByLabel('사용자 아이디').fill('e2e-user');
  await dlg.getByLabel('소속 기관').fill('PROFCYS');
  await dlg.getByText('E2E 보고서 도우미').click();
  await dlg.getByRole('button', { name: '등록' }).click();
  await ap.getByText('임시 비밀번호 발급 완료').waitFor();
  tempPassword = (await ap.locator('.secret-box .grow').innerText()).trim();
  assert(tempPassword.length >= 12, '임시 비밀번호가 표시되지 않음');
  await ap.getByRole('button', { name: '확인했습니다' }).click();
  await ap.getByRole('row', { name: /e2e-user/ }).waitFor();
});

await step('화면 구성 관리: PC/태블릿/모바일 미리보기 전환', async () => {
  await ap.goto(BASE + '/admin/ui');
  await ap.getByRole('tab', { name: /태블릿/ }).click();
  await ap.getByRole('tab', { name: /모바일/ }).click();
  await ap.locator('.preview-frame [data-testid="service-grid"]').first().waitFor();
  await ap.screenshot({ path: path.join(out, 'admin-ui-preview.png') });
});

await step('관리자 화면 PC 가로 스크롤 없음 (홈·사용자·서비스·통계)', async () => {
  for (const p of ['', '/users', '/services', '/stats', '/logs/access']) {
    await ap.goto(BASE + '/admin' + p);
    await ap.locator('h1').first().waitFor();
    await ap.waitForTimeout(300);
    await noHorizontalScroll(ap, 'admin' + p);
  }
});

const user = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
user.setDefaultTimeout(15000);
const up = await user.newPage();
shotPages.push(up);

await step('일반 사용자: 임시 비밀번호 로그인 → 비밀번호 변경 강제 → 권한 서비스 1개만 표시', async () => {
  await login(up, 'e2e-user', tempPassword);
  await changePassword(up, tempPassword, USER_PW);
  await up.waitForURL(BASE + '/');
  const grid = up.locator('[data-testid="service-grid"]');
  await grid.waitFor();
  const cards = await up.locator('[data-testid="service-grid"] .svc-card').count();
  assert(cards === 1, `카드 수 ${cards} (기대 1)`);
  assert(await up.getByText('E2E 보고서 도우미').count(), '부여된 서비스가 보이지 않음');
  assert(!(await up.getByText('공통작업 플랫폼').count()), '권한 없는 서비스가 노출됨');
  const html = await up.content();
  assert(!html.includes('e2e-report.web.app') && !html.includes('script.google.com'), '서비스 URL 이 HTML 에 노출됨');
  await up.screenshot({ path: path.join(out, 'user-dashboard-pc.png') });
});

await step('일반 사용자: 관리자 화면 접근 차단 (403)', async () => {
  await up.goto(BASE + '/admin');
  await up.getByText('접근 권한이 없습니다').waitFor();
  await up.goto(BASE + '/');
});

await step('서비스 실행: 서버 재검증 후 새 탭으로 이동 (opener 제거)', async () => {
  const card = up.locator('.svc-card', { hasText: 'E2E 보고서 도우미' });
  await up.route('https://e2e-report.web.app/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>target</title>ok' }));
  await user.route('https://e2e-report.web.app/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>target</title><script>document.title = String(window.opener)</script>' }));
  const [popup] = await Promise.all([up.waitForEvent('popup'), card.getByRole('button', { name: /접속|E2E 보고서 도우미/ }).first().click()]);
  await popup.waitForURL('https://e2e-report.web.app/**', { timeout: 15000 });
  await popup.waitForLoadState();
  assert((await popup.title()) === 'null', 'window.opener 가 제거되지 않음');
  await popup.close();
});

await step('권한 회수 즉시 반영: 관리자가 권한 해제 → 사용자 실행 거부', async () => {
  await ap.goto(BASE + '/admin/permissions');
  const row = ap.getByRole('row', { name: /e2e-user/ });
  await row.getByRole('checkbox', { name: /E2E 보고서 도우미/ }).uncheck();
  await ap.getByRole('button', { name: /변경 사항 저장/ }).click();
  await ap.getByText(/권한 저장: 1명 반영/).waitFor();
  await up.reload();
  await up.getByText(/이용 가능한 서비스가 없습니다|표시할 서비스가 없습니다|권한/).first().waitFor({ timeout: 15000 });
  assert(!(await up.locator('.svc-card', { hasText: 'E2E 보고서 도우미' }).count()), '회수 후에도 카드가 남아 있음');
});

await step('자동 레이아웃: 서비스 1/4/6/10개 × 390/820/1440px 열 수와 가로 스크롤', async () => {
  // 관리자 API 로 서비스 10개를 만들고 사용자에게 개수별로 권한을 부여한다 (UI 와 같은 API 사용)
  const token = await ap.evaluate(() => JSON.parse(localStorage.getItem('profcys.session.v1') || 'null'));
  const tok = token && token.t;
  assert(tok, '관리자 토큰을 찾지 못함');
  const call = (action, params) => ap.evaluate(async ([a, p, t]) => (await fetch('/api', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ action: a, params: p, token: t }) })).json(), [action, params, tok]);
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const r = await call('admin.services.create', { serviceName: `레이아웃 서비스 ${i + 1}`, url: `https://layout-${i}.web.app`, mode: 'quick' });
    assert(r.ok, 'create ' + JSON.stringify(r.error));
    await call('admin.services.setStatus', { serviceId: r.data.service.serviceId, status: 'ACTIVE', approve: true });
    ids.push(r.data.service.serviceId);
  }
  const users = await call('admin.users.list', { query: 'e2e-user' });
  const uid = users.data.items[0].uid;
  const expected = { 1: { 390: 1, 820: 1, 1440: 1 }, 4: { 390: 1, 820: 2, 1440: 2 }, 6: { 390: 1, 820: 2, 1440: 3 }, 10: { 390: 1, 820: 2, 1440: 4 } };
  const problems = [];
  for (const n of [1, 4, 6, 10]) {
    await call('admin.users.update', { uid, patch: { allowedServices: ids.slice(0, n) } });
    for (const w of [390, 820, 1440]) {
      await up.setViewportSize({ width: w, height: 900 });
      await up.goto(BASE + '/');
      const grid = up.locator('[data-testid="service-grid"]').first();
      await grid.waitFor();
      await up.waitForTimeout(200);
      const cols = Number(await grid.getAttribute('data-columns'));
      if (cols !== expected[n][w]) problems.push(`${n}개@${w}px: ${cols}열 (기대 ${expected[n][w]})`);
      try { await noHorizontalScroll(up, `${n}개@${w}px`); } catch (e) { problems.push(e.message); }
      if ((n === 10 && w !== 820) || (n === 1 && w === 1440)) await up.screenshot({ path: path.join(out, `layout-${n}-${w}.png`) });
    }
  }
  assert(!problems.length, problems.join('; '));
});

await step('로그아웃 후 뒤로가기로 대시보드 재진입 불가', async () => {
  await up.setViewportSize({ width: 1440, height: 900 });
  await up.goto(BASE + '/');
  await up.getByRole('button', { name: /사용자 메뉴|계정|e2e-user|김테스트/ }).first().click();
  await up.getByRole('menuitem', { name: '로그아웃' }).or(up.getByRole('button', { name: '로그아웃' })).first().click();
  await up.waitForURL('**/login');
  await up.goBack();
  await up.waitForURL('**/login', { timeout: 10000 });
});

await step('브라우저 저장소에 비밀번호 미저장', async () => {
  for (const p of [ap, up]) {
    const dump = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    for (const secret of [INIT_PW, ADMIN_PW, USER_PW, tempPassword].filter(Boolean)) assert(!dump.includes(secret), '저장소에 비밀번호가 있음');
  }
});

await step('페이지 스크립트 오류 없음', async () => {
  assert(!consoleErrors.length, consoleErrors.join('\n'));
});

await browser.close();
server.kill();
const summary = { at: new Date().toISOString(), pass: results.filter((r) => r.result === 'PASS').length, fail: results.filter((r) => r.result === 'FAIL').length, results, serviceId };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 2));
console.log(`\nE2E: PASS ${summary.pass} / FAIL ${summary.fail}  → test-results/e2e/report.json`);
process.exit(summary.fail ? 1 : 0);
