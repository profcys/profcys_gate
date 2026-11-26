/** 서버 규칙 단위 테스트: 비밀번호 정책, 아이디 규칙, URL 검증, 정책 평가, 임시 비밀번호 */
import { describe, expect, it } from 'vitest';
import { loadGateway } from '../../dev/memory-platform.mjs';

const { context: c } = loadGateway();
const fn = (name) => c[name] || (() => { throw new Error(name); });

describe('비밀번호 정책 (23장)', () => {
  const v = fn('passwordPolicyViolations_');
  it('12자 미만·3종류 미만·흔한 비밀번호·아이디 포함 거부', () => {
    expect(v('Ab1!short')).not.toHaveLength(0);
    expect(v('alllowercaseletters')).not.toHaveLength(0);
    expect(v('Profcys2026!!x', { username: 'profcys' })).not.toHaveLength(0);
    expect(v('Correct-Horse-42')).toHaveLength(0);
  });
  it('임시 비밀번호는 16자, 4종류 문자, 매번 다름, 정책 통과', () => {
    const gen = fn('generateTemporaryPassword_');
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const p = gen();
      expect(p).toHaveLength(16);
      expect(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)).toBe(true);
      expect(/[0O1lI]/.test(p)).toBe(false);
      expect(v(p)).toHaveLength(0);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('URL 검증·SSRF 방지 (16장)', () => {
  const check = (url) => fn('validateServiceUrl_')(url, { allowedDomains: ['script.google.com', 'web.app'], existing: [] });
  it.each([
    'https://script.google.com/macros/s/AKfyc/exec',
    'https://my-app.web.app/path?x=1',
  ])('허용: %s', (u) => expect(check(u).ok).toBe(true));
  it.each([
    ['', 'URL_REQUIRED'], ['ftp://web.app', 'URL_DANGEROUS_SCHEME'], ['http://web.app', 'URL_HTTPS_REQUIRED'], ['data:text/html,x', 'URL_DANGEROUS_SCHEME'],
    ['https://10.0.0.1/', 'URL_IP_NOT_ALLOWED'], ['https://[::1]/', 'URL_INVALID'], ['https://0x7f000001/', 'URL_IP_NOT_ALLOWED'], ['https://169.254.169.254/latest', 'URL_IP_NOT_ALLOWED'],
    ['https://metadata.google.internal/', 'URL_INTERNAL_HOST'], ['https://web.app.evil.com/', 'URL_DOMAIN_NOT_ALLOWED'],
    ['https://evilweb.app/', 'URL_DOMAIN_NOT_ALLOWED'], ['https://a@web.app/', 'URL_USERINFO'],
  ])('거부: %s → %s', (u, code) => {
    const r = check(u);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain(code);
  });
  it('서비스 유형 자동 분류', () => {
    expect(check('https://script.google.com/macros/s/x/exec').serviceType).toBe('APPS_SCRIPT');
    expect(check('https://abc.web.app').serviceType).toBe('FIREBASE_HOSTING');
  });
});

describe('서비스 접근 정책 평가 (13·22장)', () => {
  const ev = fn('evaluateServiceForUser_');
  const settings = { showRestrictedServices: false };
  const now = Date.now();
  const svc = (o = {}) => ({ serviceId: 's1', status: 'ACTIVE', accessPolicy: { mode: 'NONE', roles: [], organizations: [], groups: [], denyUserIds: [] }, ...o });
  const user = (o = {}) => ({ uid: 'u1', role: 'USER', status: 'ACTIVE', allowedServices: [], delegatedServices: [], groups: [], organization: 'A', ...o });
  it('기본 거부, 개별 부여 시 허용', () => {
    expect(ev(user(), svc(), now, settings).canLaunch).toBe(false);
    expect(ev(user({ allowedServices: ['s1'] }), svc(), now, settings).canLaunch).toBe(true);
  });
  it('거부 목록이 개별 부여·전체 공개보다 우선', () => {
    const s = svc({ accessPolicy: { mode: 'ALL', roles: [], organizations: [], groups: [], denyUserIds: ['u1'] } });
    expect(ev(user({ allowedServices: ['s1'] }), s, now, settings).canLaunch).toBe(false);
  });
  it('조건 정책: 기관·그룹 모두 충족해야 허용', () => {
    const s = svc({ accessPolicy: { mode: 'RULES', roles: [], organizations: ['A'], groups: ['g1'], denyUserIds: [] } });
    expect(ev(user({ groups: ['g1'] }), s, now, settings).canLaunch).toBe(true);
    expect(ev(user({ groups: [] }), s, now, settings).canLaunch).toBe(false);
    expect(ev(user({ organization: 'B', groups: ['g1'] }), s, now, settings).canLaunch).toBe(false);
  });
  it('초안·비활성 서비스는 권한이 있어도 실행 불가', () => {
    for (const status of ['DRAFT', 'INACTIVE', 'ARCHIVED']) {
      expect(ev(user({ allowedServices: ['s1'] }), svc({ status }), now, settings).canLaunch).toBe(false);
    }
  });
  it('공개 종료일이 지나면 만료', () => {
    expect(fn('effectiveServiceStatus_')(svc({ expireAt: now - 1 }), now)).toBe('EXPIRED');
  });
});
