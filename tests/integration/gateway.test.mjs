/**
 * 게이트웨이 API 통합 테스트 — 실제 Apps Script 서버 코드를 Node vm 에서 실행 (메모리 Firestore/Auth)
 * 명세 33장 테스트 항목 중 서버 측 보안·권한·동적 서비스·SSO·복원 시나리오를 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { loadGateway } from '../../dev/memory-platform.mjs';
import { ADMIN_PW, USER_PW, setup } from '../helpers.mjs';

const INITIAL_URLS = {
  'common-work': 'https://script.google.com/macros/s/AKfycbyWx-AzrUQ5uqe9DSVEefQioUIElTtTF7kyZH1x8fc42GgWXonZ7Owkk6cVXmKgM6Eg2Q/exec',
  'mentor-matching': 'https://script.google.com/macros/s/AKfycbxryZa0Rh2fTy8D3xq86mjbRfLkByKmdcgbLTEuw7qAgwez5uDBb9FR1boWDSJmJLdj2w/exec',
  'startup-mentoring': 'https://script.google.com/macros/s/AKfycbxGe1bxigLLQwcYZFn-S5k1JlVipK1v9io7bCjkEJdLImjAr7XqEhsXrYYyvnGGntpwVg/exec',
  'startup-evaluation': 'https://script.google.com/macros/s/AKfycbwt1eygC06UCPJ24L-tzfb36irrTl2NUX7nrKzBgNeR1gO20td5rDJ-a2SYEf-B8NF0/exec',
};

describe('최초 설정·관리자 계정 (9장)', () => {
  it('설정 토큰 없이는 bootstrap 불가, 토큰은 1회용, profcys 는 최초 비밀번호 변경 필수', () => {
    const g = loadGateway();
    expect(g.call('bootstrap', { setupToken: 'x', password: 'Init!Passw0rd#01' }).error.code).toBe('SETUP_DISABLED');
    g.platform.props.set('SETUP_TOKEN', 'abc123abc123');
    expect(g.call('bootstrap', { setupToken: 'wrong', password: 'Init!Passw0rd#01' }).error.code).toBe('SETUP_TOKEN_INVALID');
    expect(g.call('bootstrap', { setupToken: 'abc123abc123', password: 'short' }).error.code).toBe('WEAK_PASSWORD');
    expect(g.call('bootstrap', { setupToken: 'abc123abc123', password: 'Init!Passw0rd#01' }).ok).toBe(true);
    expect(g.platform.props.get('SETUP_TOKEN')).toBeNull();
    g.platform.props.set('SETUP_TOKEN', 'again12345678');
    expect(g.call('bootstrap', { setupToken: 'again12345678', password: 'Other!Passw0rd#9' }).error.code).toBe('ALREADY_INITIALIZED');
    const l = g.call('login', { username: 'PROFCYS', password: 'Init!Passw0rd#01' });
    expect(l.ok).toBe(true);
    expect(l.data.user.role).toBe('SUPER_ADMIN');
    expect(l.data.user.mustChangePassword).toBe(true);
    expect(g.call('dashboard', {}, l.data.token).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('비밀번호 평문은 DB·설정 어디에도 저장되지 않음', () => {
    const { g } = setup();
    const dump = JSON.stringify({ store: g.platform.store.dump(), props: Object.fromEntries(g.platform.props.map) });
    expect(dump).not.toContain(ADMIN_PW);
    expect(dump).not.toContain('Init!Passw0rd#01');
  });

  it('초기 서비스 4개가 명세 URL 그대로, 비공개 초안으로 등록됨', () => {
    const { ok } = setup();
    const { services } = ok('admin.services.list', {});
    expect(services.map((s) => s.serviceId).sort()).toEqual(Object.keys(INITIAL_URLS).sort());
    for (const s of services) {
      expect(s.url).toBe(INITIAL_URLS[s.serviceId]);
      expect(s.status).toBe('DRAFT');
      expect(s.accessPolicy.mode).toBe('NONE');
    }
  });
});

describe('로그인·세션 (10·23장)', () => {
  it('자체 회원가입 API 없음, 잘못된 비밀번호 5회 → 잠금, 존재하지 않는 아이디와 같은 오류', () => {
    const { g, createUser } = setup();
    createUser('lee01');
    expect(g.call('register', { username: 'x', password: 'y' }).error.code).toBe('UNKNOWN_ACTION');
    const unknown = g.call('login', { username: 'nobody', password: 'Wrong!Passw0rd1' });
    const wrong = g.call('login', { username: 'lee01', password: 'Wrong!Passw0rd1' });
    expect(unknown.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.error.message).toBe(wrong.error.message);
    for (let i = 0; i < 4; i++) g.call('login', { username: 'lee01', password: 'Wrong!Passw0rd1' });
    expect(g.call('login', { username: 'lee01', password: USER_PW }).error.code).toBe('LOGIN_LOCKED');
    g.platform.advance(16 * 60000);
    expect(g.call('login', { username: 'lee01', password: USER_PW }).ok).toBe(true);
  });

  it('60분 미사용 시 서버에서 세션 만료, 로그아웃 후 토큰 재사용 불가', () => {
    const { g, createUser } = setup();
    const u = createUser('park01');
    expect(g.call('session', {}, u.token).ok).toBe(true);
    g.platform.advance(61 * 60000);
    expect(g.call('dashboard', {}, u.token).error.code).toBe('SESSION_EXPIRED');
    const l = g.call('login', { username: 'park01', password: USER_PW });
    expect(g.call('logout', {}, l.data.token).ok).toBe(true);
    expect(g.call('dashboard', {}, l.data.token).ok).toBe(false);
  });

  it('최대 세션 12시간', () => {
    const { g, createUser } = setup();
    const u = createUser('choi01');
    for (let i = 0; i < 12; i++) { g.platform.advance(59 * 60000); expect(g.call('touch', {}, u.token).ok).toBe(true); }
    g.platform.advance(15 * 60000);
    expect(g.call('dashboard', {}, u.token).error.code).toBe('SESSION_EXPIRED');
  });

  it('비활성화·기간 만료 계정은 로그인 불가, 강제 로그아웃 즉시 반영', () => {
    const { g, ok, createUser } = setup();
    const u = createUser('jung01');
    ok('admin.users.revokeSessions', { uid: u.uid });
    expect(g.call('dashboard', {}, u.token).error.code).toBe('SESSION_REVOKED');
    ok('admin.users.update', { uid: u.uid, patch: { status: 'INACTIVE' } });
    expect(g.call('login', { username: 'jung01', password: USER_PW }).ok).toBe(false);
    ok('admin.users.update', { uid: u.uid, patch: { status: 'ACTIVE', validUntil: '2020-01-01' } });
    expect(g.call('login', { username: 'jung01', password: USER_PW }).ok).toBe(false);
  });
});

describe('권한 (13·22장)', () => {
  it('일반 사용자는 관리자 API 호출 불가, 운영관리자는 최고관리자 전용 기능 불가', () => {
    const { g, createUser, call } = setup();
    const u = createUser('user01');
    for (const a of ['admin.users.list', 'admin.services.list', 'admin.settings.get', 'admin.logs.access', 'admin.backup.export']) {
      expect(g.call(a, {}, u.token).error.code).toBe('FORBIDDEN');
    }
    const op = createUser('op01', { role: 'ADMIN' });
    expect(call('admin.settings.save', { settings: { platformName: 'x' } }, op.token).error.code).toBe('FORBIDDEN');
    expect(call('admin.services.create', { serviceName: 'x', url: 'https://example.web.app' }, op.token).error.code).toBe('FORBIDDEN');
    expect(call('admin.users.create', { username: 'evil01', displayName: 'e', role: 'SUPER_ADMIN', generatePassword: true }, op.token).ok).toBe(false);
  });

  it('신규 사용자 기본 권한 없음 → 부여 시 표시 → 회수 즉시 차단, 대시보드 응답에 URL 미포함', () => {
    const { g, ok, createUser, publish } = setup();
    publish('common-work');
    publish('mentor-matching');
    const u = createUser('kim01');
    let d = ok('dashboard', {}, u.token);
    expect(d.services).toHaveLength(0);
    ok('admin.users.update', { uid: u.uid, patch: { allowedServices: ['common-work'] } });
    d = ok('dashboard', {}, u.token);
    expect(d.services.map((s) => s.serviceId)).toEqual(['common-work']);
    expect(JSON.stringify(d)).not.toContain('script.google.com');
    expect(ok('launch', { serviceId: 'common-work' }, u.token).url).toBe(INITIAL_URLS['common-work']);
    const denied = g.call('launch', { serviceId: 'mentor-matching' }, u.token);
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).not.toContain('script.google.com');
    ok('admin.users.update', { uid: u.uid, patch: { allowedServices: [] } });
    expect(g.call('launch', { serviceId: 'common-work' }, u.token).ok).toBe(false);
  });

  it('잠금 카드 표시 설정 시에도 권한 없는 서비스의 URL·설명은 노출되지 않음', () => {
    const { ok, createUser, publish } = setup();
    publish('common-work');
    ok('admin.settings.save', { settings: { showRestrictedServices: true } });
    const u = createUser('kim02');
    const d = ok('dashboard', {}, u.token);
    const card = d.services.find((s) => s.serviceId === 'common-work');
    expect(card.state).toBe('LOCKED');
    expect(card.canLaunch).toBe(false);
    expect(card.url).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain('script.google.com');
  });

  it('마지막 최고관리자는 삭제·비활성화·강등 불가', () => {
    const { g, ok, call } = setup();
    const me = ok('session', {}).user;
    expect(call('admin.users.update', { uid: me.uid, patch: { status: 'INACTIVE' } }, undefined).ok).toBe(false);
    const r1 = call('admin.users.delete', { uid: me.uid, confirmUsername: 'profcys', reauthPassword: ADMIN_PW });
    expect(r1.ok).toBe(false);
    const self = call('admin.users.update', { uid: me.uid, patch: { role: 'USER' }, reauthPassword: ADMIN_PW });
    expect(self.ok).toBe(false);
  });
});

describe('동적 서비스 (14~17장)', () => {
  it('신규 서비스는 초안·권한 없음으로 등록되고 공개 승인 전에는 아무에게도 표시되지 않음', () => {
    const { g, ok, createUser, call } = setup();
    const u = createUser('svc01');
    const { service } = ok('admin.services.create', { serviceName: 'AI 보고서 도우미', url: 'https://ai-report.web.app', mode: 'quick' });
    expect(service.status).toBe('DRAFT');
    expect(service.accessPolicy.mode).toBe('NONE');
    expect(service.serviceType).toBe('FIREBASE_HOSTING');
    ok('admin.users.update', { uid: u.uid, patch: { allowedServices: [service.serviceId] } });
    expect(ok('dashboard', {}, u.token).services).toHaveLength(0);
    expect(call('admin.services.setStatus', { serviceId: service.serviceId, status: 'ACTIVE' }).error.code).toBe('APPROVAL_REQUIRED');
    const pub = ok('admin.services.setStatus', { serviceId: service.serviceId, status: 'ACTIVE', approve: true });
    expect(pub.warnings.length).toBeGreaterThan(0);
    const d = ok('dashboard', {}, u.token);
    expect(d.services.map((s) => s.serviceId)).toEqual([service.serviceId]);
    expect(d.services[0].isNew).toBe(true);
  });

  it.each([
    ['http://example.web.app', 'URL_HTTPS_REQUIRED'],
    ['javascript:alert(1)', 'URL_DANGEROUS_SCHEME'],
    ['https://127.0.0.1/x', 'URL_IP_NOT_ALLOWED'],
    ['https://localhost/x', 'URL_INTERNAL_HOST'],
    ['https://user:pw@example.web.app', 'URL_USERINFO'],
    ['https://evil.example.com/', 'URL_DOMAIN_NOT_ALLOWED'],
    ['https://example.web.app:8443/', 'URL_PORT_NOT_ALLOWED'],
  ])('위험 URL 차단: %s', (url, code) => {
    const { ok } = setup();
    const r = ok('admin.services.checkUrl', { url, skipProbe: true });
    expect(r.validation.ok).toBe(false);
    expect(r.validation.errors.map((e) => e.code)).toContain(code);
  });

  it('중복 URL 등록 차단', () => {
    const { g, call } = setup();
    expect(call('admin.services.create', { serviceName: '중복', url: INITIAL_URLS['common-work'] }).error.code).toBe('URL_DUPLICATE');
  });

  it('동시 수정 충돌 감지 (baseVersion)', () => {
    const { g, ok, call } = setup();
    const s = ok('admin.services.get', { serviceId: 'common-work' }).service;
    ok('admin.services.update', { serviceId: 'common-work', baseVersion: s.version, patch: { description: 'A' } });
    expect(call('admin.services.update', { serviceId: 'common-work', baseVersion: s.version, patch: { description: 'B' } }).error.code).toBe('CONFLICT');
  });

  it('점검·비활성·예약 공개·공개 종료가 사용자 화면에 즉시 반영', () => {
    const { g, ok, createUser, publish } = setup();
    publish('common-work');
    const u = createUser('st01', { allowedServices: ['common-work'] });
    ok('admin.services.setStatus', { serviceId: 'common-work', status: 'MAINTENANCE', maintenanceMessage: '점검 중' });
    let d = ok('dashboard', {}, u.token);
    expect(d.services[0].state).toBe('MAINTENANCE');
    expect(g.call('launch', { serviceId: 'common-work' }, u.token).ok).toBe(false);
    ok('admin.services.setStatus', { serviceId: 'common-work', status: 'INACTIVE' });
    expect(ok('dashboard', {}, u.token).services).toHaveLength(0);
    ok('admin.services.setStatus', { serviceId: 'common-work', status: 'SCHEDULED', approve: true, publishAt: g.platform.now() + 30 * 60000 });
    expect(ok('dashboard', {}, u.token).services).toHaveLength(0);
    g.platform.advance(30 * 60000 + 1000);
    d = ok('dashboard', {}, u.token);
    expect(d.services.map((s) => s.state)).toEqual(['AVAILABLE']);
  });

  it('보관 후에만 영구 삭제, 삭제된 ID 는 재사용·복원되지 않고 권한도 제거', () => {
    const { g, ok, createUser, call } = setup();
    const { service } = ok('admin.services.create', { serviceName: '임시', url: 'https://tmp-svc.web.app', serviceId: 'tmp-svc' });
    const u = createUser('del01', { allowedServices: ['tmp-svc'] });
    expect(call('admin.services.purge', { serviceId: 'tmp-svc', confirmServiceId: 'tmp-svc', reauthPassword: ADMIN_PW }).error.code).toBe('INVALID_STATE');
    ok('admin.services.setStatus', { serviceId: 'tmp-svc', status: 'ARCHIVED' });
    expect(call('admin.services.purge', { serviceId: 'tmp-svc', confirmServiceId: 'tmp-svc', reauthPassword: 'wrong' }).ok).toBe(false);
    ok('admin.services.purge', { serviceId: 'tmp-svc', confirmServiceId: 'tmp-svc', reauthPassword: ADMIN_PW });
    expect(ok('admin.users.get', { uid: u.uid }).user.allowedServices).not.toContain('tmp-svc');
    const again = ok('admin.services.create', { serviceName: '임시2', url: 'https://tmp-svc2.web.app', serviceId: 'tmp-svc' });
    expect(again.service.serviceId).not.toBe('tmp-svc');
    expect(service.serviceId).toBe('tmp-svc');
  });

  it('변경 이력 복원은 URL 재검증, 접근 정책 유지, 공개 상태 자동 복원 안 함', () => {
    const { g, ok, call } = setup();
    ok('admin.services.update', { serviceId: 'common-work', patch: { description: '변경 전' } });
    ok('admin.services.update', { serviceId: 'common-work', patch: { description: '변경 후', accessPolicy: { mode: 'ALL' } } });
    const hist = ok('admin.services.history', { serviceId: 'common-work' }).items;
    const target = hist.find((h) => h.changeSummary.includes('accessPolicy'));
    ok('admin.services.update', { serviceId: 'common-work', patch: { accessPolicy: { mode: 'NONE' } } });
    const r = ok('admin.services.restore', { logId: target.logId, which: 'previous' });
    expect(r.restored).toBe(true);
    const s = ok('admin.services.get', { serviceId: 'common-work' }).service;
    expect(s.description).toBe('변경 전');
    expect(s.accessPolicy.mode).toBe('NONE'); // 회수된 정책이 복원으로 재활성화되지 않음
    expect(call('admin.services.restore', { logId: 'nope' }).ok).toBe(false);
  });

  it('서비스 100개 등록 후 대시보드가 권한 있는 서비스만 반환', () => {
    const { ok, createUser } = setup();
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const { service } = ok('admin.services.create', { serviceName: `서비스 ${i}`, url: `https://svc-${i}.web.app`, mode: 'quick' });
      ok('admin.services.setStatus', { serviceId: service.serviceId, status: 'ACTIVE', approve: true });
      ids.push(service.serviceId);
    }
    const u = createUser('many01', { allowedServices: ids.slice(0, 37) });
    const d = ok('dashboard', {}, u.token);
    expect(d.services).toHaveLength(37);
    expect(d.counts.available).toBe(37);
  });
});

describe('통합 인증 SSO (21장)', () => {
  function ssoSetup() {
    const ctx = setup();
    ctx.publish('common-work');
    ctx.publish('mentor-matching');
    ctx.ok('admin.services.update', { serviceId: 'common-work', patch: { openMode: 'SSO' } });
    ctx.ok('admin.services.update', { serviceId: 'mentor-matching', patch: { openMode: 'SSO' } });
    const key = ctx.ok('admin.services.rotateKey', { serviceId: 'common-work', reauthPassword: ADMIN_PW }).serviceKey;
    const key2 = ctx.ok('admin.services.rotateKey', { serviceId: 'mentor-matching', reauthPassword: ADMIN_PW }).serviceKey;
    const u = ctx.createUser('sso01', { allowedServices: ['common-work', 'mentor-matching'] });
    return { ...ctx, key, key2, u };
  }

  it('정상 교환 후 같은 코드 재사용 불가', () => {
    const { g, ok, key, u } = ssoSetup();
    const l = ok('launch', { serviceId: 'common-work' }, u.token);
    expect(l.sso.code).toMatch(/^[0-9a-f]{64}$/);
    const v = g.call('sso.verify', { code: l.sso.code, serviceId: 'common-work', serviceKey: key });
    expect(v.ok).toBe(true);
    expect(v.data.user.username).toBe('sso01');
    expect(g.call('sso.verify', { code: l.sso.code, serviceId: 'common-work', serviceKey: key }).error.code).toBe('CODE_REUSED');
  });

  it('다른 서비스용 코드·잘못된 키·만료 코드 거부', () => {
    const { g, ok, key, key2, u } = ssoSetup();
    const l = ok('launch', { serviceId: 'common-work' }, u.token);
    expect(g.call('sso.verify', { code: l.sso.code, serviceId: 'mentor-matching', serviceKey: key2 }).error.code).toBe('CODE_WRONG_SERVICE');
    expect(g.call('sso.verify', { code: l.sso.code, serviceId: 'common-work', serviceKey: 'pk_wrong' }).error.code).toBe('INVALID_SERVICE_KEY');
    const l2 = ok('launch', { serviceId: 'common-work' }, u.token);
    g.platform.advance(61000);
    expect(g.call('sso.verify', { code: l2.sso.code, serviceId: 'common-work', serviceKey: key }).error.code).toBe('CODE_EXPIRED');
  });

  it('권한 회수·로그아웃 후 sso.check 실패', () => {
    const { g, ok, key, u } = ssoSetup();
    const l = ok('launch', { serviceId: 'common-work' }, u.token);
    const v = ok('sso.verify', { code: l.sso.code, serviceId: 'common-work', serviceKey: key });
    expect(ok('sso.check', { uid: v.user.uid, sessionRef: v.sessionRef, serviceId: 'common-work', serviceKey: key }).valid).toBe(true);
    ok('admin.users.update', { uid: u.uid, patch: { allowedServices: ['mentor-matching'] } });
    expect(ok('sso.check', { uid: v.user.uid, sessionRef: v.sessionRef, serviceId: 'common-work', serviceKey: key }).valid).toBe(false);
    ok('admin.users.update', { uid: u.uid, patch: { allowedServices: ['common-work'] } });
    expect(ok('sso.check', { uid: v.user.uid, sessionRef: v.sessionRef, serviceId: 'common-work', serviceKey: key }).valid).toBe(true);
    ok('logout', {}, u.token);
    expect(ok('sso.check', { uid: v.user.uid, sessionRef: v.sessionRef, serviceId: 'common-work', serviceKey: key }).valid).toBe(false);
  });

  it('서비스 키 원문은 저장되지 않고 재발급 시 이전 키 무효', () => {
    const { g, ok, key, u } = ssoSetup();
    expect(JSON.stringify(g.platform.store.dump())).not.toContain(key);
    ok('admin.services.rotateKey', { serviceId: 'common-work', reauthPassword: ADMIN_PW });
    const l = ok('launch', { serviceId: 'common-work' }, u.token);
    expect(g.call('sso.verify', { code: l.sso.code, serviceId: 'common-work', serviceKey: key }).error.code).toBe('INVALID_SERVICE_KEY');
  });
});

describe('로그·통계·백업 (25·26·30장)', () => {
  it('로그에 비밀번호·인증 코드·세션 토큰이 기록되지 않음', () => {
    const { g, ok, createUser, publish } = setup();
    publish('common-work');
    const u = createUser('log01', { allowedServices: ['common-work'] });
    g.call('login', { username: 'log01', password: 'Wrong!Passw0rd1' });
    ok('launch', { serviceId: 'common-work' }, u.token);
    const logs = JSON.stringify([ok('admin.logs.access', { limit: 500 }), ok('admin.logs.admin', { limit: 500 })]);
    expect(logs).not.toContain(USER_PW);
    expect(logs).not.toContain('Wrong!Passw0rd1');
    expect(logs).not.toContain(ADMIN_PW);
    expect(logs).not.toContain(u.token);
    expect(logs).not.toContain(u.temporaryPassword);
  });

  it('통계는 실제 기록 기준 (로그인 사용자 중복 제거, 서비스 실행 수)', () => {
    const { ok, createUser, publish } = setup();
    publish('common-work');
    const a = createUser('st-a', { allowedServices: ['common-work'] });
    createUser('st-b');
    ok('launch', { serviceId: 'common-work' }, a.token);
    ok('launch', { serviceId: 'common-work' }, a.token);
    const s = ok('admin.stats', {});
    const today = s.daily[s.daily.length - 1];
    expect(today.loginUsers).toBeGreaterThanOrEqual(3); // profcys, st-a, st-b (중복 제거)
    expect(s.services.find((x) => x.serviceId === 'common-work').serviceLaunch).toBe(2);
  });

  it('백업에는 비밀번호·인증 이메일·키가 없고, 복원은 사용자 권한을 되살리지 않음', () => {
    const { g, ok, createUser, call } = setup();
    const u = createUser('bk01', { allowedServices: ['common-work'] });
    const backup = ok('admin.backup.export', {});
    const text = JSON.stringify(backup);
    expect(text).not.toContain(USER_PW);
    expect(text).not.toMatch(/u[0-9a-f]{8,}@/); // 인증용 내부 이메일 미포함
    ok('admin.users.update', { uid: u.uid, patch: { allowedServices: [] } });
    ok('admin.backup.restore', { data: backup, scope: { services: true, categories: true, announcements: true }, reauthPassword: ADMIN_PW });
    expect(ok('admin.users.get', { uid: u.uid }).user.allowedServices).toEqual([]);
    expect(call('admin.backup.restore', { data: { meta: { platform: 'other' } }, scope: {}, reauthPassword: ADMIN_PW }).ok).toBe(false);
  });
});
