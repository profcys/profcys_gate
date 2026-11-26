/**
 * ProfcysAuth — 기존 업무 Apps Script 웹앱용 PROFCYS 통합 인증 공통 모듈 (21장)
 * 파일: apps-script/shared-auth/ProfcysAuth.js  (각 업무 Apps Script 프로젝트에 이 파일 하나를 추가)
 *
 * 동작
 *  1) 사용자가 PROFCYS 포털에서 서비스를 실행하면, 포털이 60초 1회용 인증 코드(profcys_code)를
 *     이 웹앱으로 POST(또는 쿼리)로 전달한다.
 *  2) 이 모듈이 서버 측에서 게이트웨이 API(sso.verify)로 코드를 교환해 사용자·권한을 확인한다.
 *     (코드는 서비스 ID 에 묶여 있고, 한 번 사용되면 다시 쓸 수 없다)
 *  3) 확인되면 이 서비스 전용 세션 토큰을 만들어 CacheService 에 저장하고 화면에 전달한다.
 *  4) google.script.run 으로 호출되는 모든 보호 함수는 ProfcysAuth.require(token) 으로 세션을 확인한다.
 *     주기적으로(기본 5분) 게이트웨이 sso.check 로 계정 상태·권한 회수·강제 로그아웃을 다시 확인한다.
 *
 * 스크립트 속성 (프로젝트 설정 › 스크립트 속성). 비밀번호는 필요 없으며 코드에 키를 적지 않는다.
 *   PROFCYS_GATEWAY_URL   게이트웨이 API 웹앱 URL (…/exec)
 *   PROFCYS_SERVICE_ID    PROFCYS 에 등록된 서비스 ID (예: common-work)
 *   PROFCYS_SERVICE_KEY   관리자 화면 [업무 서비스 관리 › 통합 인증 키]에서 발급한 키 (pk_…)
 *   PROFCYS_PORTAL_URL    포털 주소 (예: https://profcys.web.app)
 *   PROFCYS_AUTH_MODE     off | monitor | enforce   (기본 monitor)
 *       off     : 모듈 비활성 (기존 동작 그대로)
 *       monitor : 포털 경유 사용자는 인증, 직접 URL 접근도 기존처럼 허용 (전환 기간용 — 기존 사용자 영향 없음)
 *       enforce : 포털 인증 코드 없이 직접 접근하면 차단 화면 표시 (직접 URL 접근 차단)
 *
 * 주의: 이 모듈은 기존 업무 데이터(시트·드라이브)를 읽거나 바꾸지 않는다.
 */
var ProfcysAuth = (function () {
  var CACHE_PREFIX = 'profcys.sess.';
  var MAX_CACHE_SEC = 21600; // CacheService 최대 6시간
  var RECHECK_SEC = 300;

  function prop_(k, d) {
    var v = PropertiesService.getScriptProperties().getProperty(k);
    return v === null || v === '' ? d : v;
  }

  function config() {
    return {
      gatewayUrl: prop_('PROFCYS_GATEWAY_URL', ''),
      serviceId: prop_('PROFCYS_SERVICE_ID', ''),
      serviceKey: prop_('PROFCYS_SERVICE_KEY', ''),
      portalUrl: prop_('PROFCYS_PORTAL_URL', 'https://profcys.web.app'),
      mode: prop_('PROFCYS_AUTH_MODE', 'monitor'),
    };
  }

  function callGateway_(action, params) {
    var c = config();
    if (!c.gatewayUrl || !c.serviceId || !c.serviceKey) throw new Error('PROFCYS_NOT_CONFIGURED');
    var payload = { action: action, params: params };
    payload.params.serviceId = c.serviceId;
    payload.params.serviceKey = c.serviceKey;
    var res = UrlFetchApp.fetch(c.gatewayUrl, {
      method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true,
    });
    var body;
    try { body = JSON.parse(res.getContentText()); } catch (e) { throw new Error('PROFCYS_GATEWAY_UNAVAILABLE'); }
    return body;
  }

  function randomToken_() {
    return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }

  function cache_() { return CacheService.getScriptCache(); }

  function saveSession_(token, s) {
    var ttl = Math.max(60, Math.min(MAX_CACHE_SEC, Math.floor((s.expiresAt - Date.now()) / 1000)));
    cache_().put(CACHE_PREFIX + token, JSON.stringify(s), ttl);
  }

  function loadSession_(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(String(token))) return null;
    var raw = cache_().get(CACHE_PREFIX + token);
    return raw ? JSON.parse(raw) : null;
  }

  /** 포털에서 전달된 인증 코드를 검증하고 서비스 세션을 만든다. 실패 시 null 과 사유를 반환 */
  function verifyCode(code) {
    if (!code || !/^[0-9a-f]{64}$/.test(String(code))) return { ok: false, reason: 'CODE_MISSING' };
    var r = callGateway_('sso.verify', { code: String(code) });
    if (!r || !r.ok) return { ok: false, reason: (r && r.error && r.error.code) || 'VERIFY_FAILED', message: r && r.error && r.error.message };
    var d = r.data;
    var token = randomToken_();
    var session = {
      user: d.user,
      sessionRef: d.sessionRef,
      expiresAt: Math.min(d.gatewaySessionExpiresAt || Date.now() + 3600000, Date.now() + MAX_CACHE_SEC * 1000),
      checkedAt: Date.now(),
      recheckSec: d.recheckIntervalSec || RECHECK_SEC,
    };
    saveSession_(token, session);
    return { ok: true, token: token, user: d.user };
  }

  /**
   * 보호된 서버 함수의 첫 줄에서 호출한다.  예) function saveData(token, data) { var user = ProfcysAuth.require(token); … }
   * 세션이 없거나, 게이트웨이에서 계정 비활성·권한 회수·로그아웃이 확인되면 예외를 던진다.
   */
  function require(token) {
    var c = config();
    if (c.mode === 'off') return null;
    var s = loadSession_(token);
    if (!s) {
      if (c.mode === 'monitor' && !token) return null; // 전환 기간: 직접 접근 사용자는 기존 동작 유지
      throw new Error('PROFCYS_SESSION_EXPIRED: 포털에서 서비스를 다시 실행하세요.');
    }
    if (Date.now() > s.expiresAt) { logout(token); throw new Error('PROFCYS_SESSION_EXPIRED: 포털에서 서비스를 다시 실행하세요.'); }
    if (Date.now() - s.checkedAt > s.recheckSec * 1000) {
      var r;
      try { r = callGateway_('sso.check', { uid: s.user.uid, sessionRef: s.sessionRef }); } catch (e) { r = null; }
      if (r && r.ok && r.data && r.data.valid) {
        s.user = r.data.user;
        s.checkedAt = Date.now();
        saveSession_(token, s);
      } else if (r && r.ok && r.data && !r.data.valid) {
        logout(token);
        throw new Error('PROFCYS_ACCESS_REVOKED: ' + r.data.reason);
      } else if (Date.now() - s.checkedAt > 3 * s.recheckSec * 1000) {
        // 게이트웨이와 장시간 통신 불가 시 안전하게 차단 (fail-closed)
        throw new Error('PROFCYS_GATEWAY_UNAVAILABLE: 잠시 후 다시 시도하세요.');
      }
    }
    return s.user;
  }

  function logout(token) {
    if (token && /^[0-9a-f]{64}$/.test(String(token))) cache_().remove(CACHE_PREFIX + token);
  }

  function esc_(s) {
    return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  }

  /** 직접 URL 접근 차단 / 인증 실패 안내 화면 */
  function blockedPage(reason) {
    var c = config();
    var msg = {
      CODE_MISSING: 'PROFCYS 통합 포털에 로그인한 뒤 서비스를 실행하세요.',
      CODE_REUSED: '이미 사용된 접속 정보입니다. 포털에서 서비스를 다시 실행하세요.',
      CODE_EXPIRED: '접속 정보가 만료되었습니다. 포털에서 서비스를 다시 실행하세요.',
      CODE_WRONG_SERVICE: '다른 서비스용 접속 정보입니다. 포털에서 다시 실행하세요.',
    }[reason] || '서비스 이용 권한을 확인하지 못했습니다. 포털에서 다시 실행하거나 관리자에게 문의하세요.';
    var html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PROFCYS 인증 필요</title></head>' +
      '<body style="font-family:\'Noto Sans KR\',system-ui,sans-serif;background:#F5F7FB;color:#102B50;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center">' +
      '<div style="max-width:420px;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(16,43,80,.08)">' +
      '<h1 style="font-size:20px;margin:0 0 12px">통합 로그인이 필요합니다</h1><p style="line-height:1.6">' + esc_(msg) + '</p>' +
      '<p style="font-size:12px;color:#64748b">오류 코드: ' + esc_(reason || 'UNKNOWN') + '</p>' +
      '<a href="' + esc_(c.portalUrl) + '" target="_top" style="display:inline-block;margin-top:8px;padding:10px 20px;background:#2563EB;color:#fff;border-radius:8px;text-decoration:none">PROFCYS 포털로 이동</a></div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('PROFCYS 인증 필요');
  }

  /**
   * doGet / doPost 공용 처리기.
   *   function doGet(e)  { return ProfcysAuth.handle(e, render); }
   *   function doPost(e) { return ProfcysAuth.handle(e, render, legacyDoPost); }
   *   function render(e, auth) { var t = HtmlService.createTemplateFromFile('Index'); t.profcysToken = auth ? auth.token : ''; return t.evaluate(); }
   * @param e         웹앱 이벤트 객체
   * @param render    function(e, auth|null) → HtmlOutput   (auth = {token, user})
   * @param fallback  (선택) profcys_code 가 없는 POST 를 기존 doPost 로 넘길 때
   */
  function handle(e, render, fallback) {
    var c = config();
    var params = (e && e.parameter) || {};
    var code = params.profcys_code;
    if (c.mode === 'off') return code || !fallback ? render(e, null) : fallback(e);
    if (code) {
      var v;
      try { v = verifyCode(code); } catch (err) { v = { ok: false, reason: String(err.message || err).split(':')[0] }; }
      if (!v.ok) return blockedPage(v.reason);
      return render(e, { token: v.token, user: v.user });
    }
    if (fallback && e && e.postData) return fallback(e); // 기존 API 성격의 POST 는 그대로 전달 (각 함수에서 require 로 보호 권장)
    if (c.mode === 'enforce') return blockedPage('CODE_MISSING');
    return render(e, null); // monitor 모드: 기존 직접 접근 허용
  }

  /** HTML 템플릿에 넣을 클라이언트 스크립트. <?!= ProfcysAuth.clientScript(profcysToken) ?> */
  function clientScript(token) {
    var c = config();
    var safeToken = /^[0-9a-f]{64}$/.test(String(token || '')) ? String(token) : '';
    var js = function (v) { return JSON.stringify(String(v)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'); };
    return '<script>window.PROFCYS = { token: ' + js(safeToken) + ', portalUrl: ' + js(c.portalUrl) + ' };' +
      'window.PROFCYS.run = function (fn) { var args = Array.prototype.slice.call(arguments, 1); return new Promise(function (ok, fail) {' +
      ' google.script.run.withSuccessHandler(ok).withFailureHandler(function (err) { var m = String(err && err.message || err);' +
      ' if (/PROFCYS_(SESSION_EXPIRED|ACCESS_REVOKED)/.test(m)) { alert("통합 로그인 세션이 종료되었습니다. 포털에서 다시 실행하세요."); window.top.location.href = window.PROFCYS.portalUrl; }' +
      ' fail(err); })[fn].apply(null, [window.PROFCYS.token].concat(args)); }); };</script>';
  }

  /** 설정 점검 (편집기에서 실행) — 키 원문은 출력하지 않는다 */
  function selfTest() {
    var c = config();
    var out = { gatewayUrl: !!c.gatewayUrl, serviceId: c.serviceId, serviceKey: c.serviceKey ? 'set (' + c.serviceKey.length + ' chars)' : 'MISSING', mode: c.mode };
    try {
      var r = callGateway_('sso.check', { uid: 'selftest', sessionRef: '0' });
      out.gateway = r && r.ok ? 'reachable, service key accepted' : 'error: ' + (r && r.error && r.error.code);
    } catch (e) { out.gateway = 'error: ' + e.message; }
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  return { config: config, handle: handle, verifyCode: verifyCode, require: require, logout: logout, blockedPage: blockedPage, clientScript: clientScript, selfTest: selfTest };
})();

/** 편집기 실행용: 설정 점검 */
function profcysSelfTest() { return ProfcysAuth.selfTest(); }
