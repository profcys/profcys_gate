/**
 * 공통 인증 모듈(ProfcysAuth.js) 통합 테스트
 * Apps Script 전역 객체(PropertiesService·CacheService·UrlFetchApp·HtmlService)를 모의 구현해
 * 실제 게이트웨이 서버 코드와 서버 간 SSO 흐름을 끝까지 실행한다.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ADMIN_PW, setup } from '../helpers.mjs';

function loadProfcysAuth(gateway, props) {
  const cache = new Map();
  const platform = gateway.g.platform;
  class FakeDate extends Date { static now() { return platform.now(); } }
  const fetchLog = [];
  const ctx = vm.createContext({
    Date: FakeDate,
    JSON, Math, String, Array, Error, console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); return e && e.exp > platform.now() ? e.v : null; },
        put: (k, v, ttl) => cache.set(k, { v, exp: platform.now() + ttl * 1000 }),
        remove: (k) => cache.delete(k),
      }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetchLog.push(JSON.parse(opts.payload).action);
        const r = gateway.g.context.handleRequest_(opts.payload);
        return { getContentText: () => JSON.stringify(r) };
      },
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
    HtmlService: { createHtmlOutput: (html) => ({ html, setTitle() { return this; } }) },
  });
  vm.runInContext(fs.readFileSync(new URL('../../apps-script/shared-auth/ProfcysAuth.js', import.meta.url), 'utf8'), ctx);
  return { ProfcysAuth: vm.runInContext('ProfcysAuth', ctx), fetchLog };
}

function prepare(mode) {
  const gw = setup();
  gw.publish('common-work');
  gw.ok('admin.services.update', { serviceId: 'common-work', patch: { openMode: 'SSO' } });
  const key = gw.ok('admin.services.rotateKey', { serviceId: 'common-work', reauthPassword: ADMIN_PW }).serviceKey;
  const user = gw.createUser('svc-user', { allowedServices: ['common-work'] });
  const props = { PROFCYS_GATEWAY_URL: 'https://gateway.example/exec', PROFCYS_SERVICE_ID: 'common-work', PROFCYS_SERVICE_KEY: key, PROFCYS_PORTAL_URL: 'https://profcys.web.app', PROFCYS_AUTH_MODE: mode };
  const { ProfcysAuth, fetchLog } = loadProfcysAuth(gw, props);
  const render = (e, auth) => ({ rendered: true, auth });
  return { gw, user, ProfcysAuth, fetchLog, render, props };
}

describe('ProfcysAuth 공통 인증 모듈', () => {
  it('monitor 모드: 포털 경유 없이도 기존처럼 화면 표시 (기존 사용자 영향 없음)', () => {
    const { ProfcysAuth, render } = prepare('monitor');
    const out = ProfcysAuth.handle({ parameter: {} }, render);
    expect(out.rendered).toBe(true);
    expect(out.auth).toBeNull();
    expect(ProfcysAuth.require('')).toBeNull();
  });

  it('enforce 모드: 인증 코드 없는 직접 URL 접근 차단', () => {
    const { ProfcysAuth, render } = prepare('enforce');
    const out = ProfcysAuth.handle({ parameter: {} }, render);
    expect(out.rendered).toBeUndefined();
    expect(out.html).toContain('통합 로그인이 필요합니다');
    expect(out.html).toContain('CODE_MISSING');
    expect(() => ProfcysAuth.require('')).toThrow(/PROFCYS_SESSION_EXPIRED/);
  });

  it('포털 코드 POST → 서버 간 검증 → 서비스 세션 → 보호 함수 호출 → 코드 재사용 차단', () => {
    const { gw, user, ProfcysAuth, render } = prepare('enforce');
    const l = gw.ok('launch', { serviceId: 'common-work' }, user.token);
    expect(l.sso.transport).toBe('POST');
    const out = ProfcysAuth.handle({ parameter: { profcys_code: l.sso.code }, postData: { contents: 'profcys_code=' + l.sso.code } }, render);
    expect(out.rendered).toBe(true);
    expect(out.auth.user.username).toBe('svc-user');
    expect(ProfcysAuth.require(out.auth.token).username).toBe('svc-user');
    const again = ProfcysAuth.handle({ parameter: { profcys_code: l.sso.code } }, render);
    expect(again.html).toContain('CODE_REUSED');
  });

  it('권한 회수 후 재확인 주기(5분)가 지나면 보호 함수 호출 차단', () => {
    const { gw, user, ProfcysAuth, render } = prepare('enforce');
    const l = gw.ok('launch', { serviceId: 'common-work' }, user.token);
    const { auth } = ProfcysAuth.handle({ parameter: { profcys_code: l.sso.code } }, render);
    gw.ok('admin.users.update', { uid: user.uid, patch: { allowedServices: [] } });
    expect(ProfcysAuth.require(auth.token).username).toBe('svc-user'); // 캐시 유효 기간 내
    gw.g.platform.advance(301000);
    expect(() => ProfcysAuth.require(auth.token)).toThrow(/PROFCYS_ACCESS_REVOKED/);
    expect(() => ProfcysAuth.require(auth.token)).toThrow(/PROFCYS_SESSION_EXPIRED/);
  });

  it('포털 로그아웃이 서비스 세션에도 반영', () => {
    const { gw, user, ProfcysAuth, render } = prepare('enforce');
    const l = gw.ok('launch', { serviceId: 'common-work' }, user.token);
    const { auth } = ProfcysAuth.handle({ parameter: { profcys_code: l.sso.code } }, render);
    gw.ok('logout', {}, user.token);
    gw.g.platform.advance(301000);
    expect(() => ProfcysAuth.require(auth.token)).toThrow(/PROFCYS_ACCESS_REVOKED/);
  });

  it('위조·형식 오류 토큰 거부, 잘못된 서비스 키는 검증 실패', () => {
    const { gw, user, ProfcysAuth, render, props } = prepare('enforce');
    expect(() => ProfcysAuth.require('a'.repeat(64))).toThrow(/PROFCYS_SESSION_EXPIRED/);
    expect(() => ProfcysAuth.require('<script>')).toThrow();
    props.PROFCYS_SERVICE_KEY = 'pk_forged';
    const l = gw.ok('launch', { serviceId: 'common-work' }, user.token);
    expect(ProfcysAuth.handle({ parameter: { profcys_code: l.sso.code } }, render).html).toContain('INVALID_SERVICE_KEY');
  });

  it('off 모드: 모듈 비활성 (즉시 원복용)', () => {
    const { ProfcysAuth, render, fetchLog } = prepare('off');
    expect(ProfcysAuth.handle({ parameter: { profcys_code: 'x' } }, render).rendered).toBe(true);
    expect(ProfcysAuth.require('anything')).toBeNull();
    expect(fetchLog).toHaveLength(0);
  });

  it('clientScript 는 토큰을 안전하게 직렬화', () => {
    const { ProfcysAuth } = prepare('enforce');
    const s = ProfcysAuth.clientScript('</script><script>alert(1)</script>');
    expect(s).not.toContain('</script><script>alert(1)');
  });
});
