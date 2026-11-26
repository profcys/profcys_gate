/**
 * PROFCYS Gateway API — 업무 서비스용 통합 인증(SSO) 엔드포인트 (21장)
 * 파일: apps-script/gateway-api/40_Sso.js
 *
 * 흐름: 포털 launch → 일회용 코드(60초, 대상 서비스 고정) 발급 → 업무 서비스가 sso.verify 로 코드 교환
 *       → 업무 서비스가 자체 세션 생성 → 보호된 서버 기능마다 sso.check 로 계정·권한·세션 재검증(짧은 캐시 허용)
 *
 * 호출자는 업무 서비스의 Apps Script 서버(UrlFetchApp)이며, 서비스별 통합 인증 키(serviceKey)로 자신을 증명한다.
 */

function verifyServiceKey_(serviceId, serviceKey) {
  const secret = platform_().store.get(COL.SERVICE_SECRETS, serviceId);
  if (!secret || !serviceKey || !safeEqual_(sha256Hex_(String(serviceKey)), secret.keyHash)) {
    logAccess_({ serviceId: serviceId, action: ACCESS_ACTIONS.SERVICE_AUTH_FAILURE, result: 'FAILURE', errorCode: 'INVALID_SERVICE_KEY' });
    fail_('INVALID_SERVICE_KEY', '서비스 인증 키가 올바르지 않습니다.');
  }
  return secret;
}

/** 게이트웨이 세션·계정·권한·서비스 상태 종합 검증 */
function ssoValidate_(uid, sessionHash, serviceId, t) {
  const user = getUser_(uid);
  const problem = accountProblem_(user, t);
  if (problem) return { ok: false, code: problem };
  const session = sessionHash ? loadSession_(sessionHash) : null;
  if (!session || session.revoked || session.uid !== uid) return { ok: false, code: 'SESSION_INVALID' };
  if (t > session.expiresAt) return { ok: false, code: 'SESSION_EXPIRED' };
  if (user.sessionsValidAfter && session.createdAt < user.sessionsValidAfter) return { ok: false, code: 'SESSION_REVOKED' };
  const s = findService_(serviceId);
  if (!s) return { ok: false, code: 'SERVICE_NOT_FOUND' };
  const ev = evaluateServiceForUser_(user, s, t, getSettings_());
  if (!ev.canLaunch) return { ok: false, code: ev.reason || 'SERVICE_NOT_AVAILABLE' };
  if (user.mustChangePassword) return { ok: false, code: 'PASSWORD_CHANGE_REQUIRED' };
  return { ok: true, user: user, session: session, service: s };
}

function ssoUserInfo_(user) {
  return { uid: user.uid, username: user.username, displayName: user.displayName, role: user.role, organization: user.organization || '', department: user.department || '', position: user.position || '', email: user.email || '' };
}

function apiSsoVerify_(p) {
  const serviceId = cleanText_(p.serviceId, 64);
  const secret = verifyServiceKey_(serviceId, p.serviceKey);
  const code = String(p.code || '');
  const t = now_();
  const failCode = function (errorCode, uid, message) {
    logAccess_({ userId: uid || '', serviceId: serviceId, action: ACCESS_ACTIONS.SERVICE_AUTH_FAILURE, result: 'FAILURE', errorCode: errorCode });
    fail_(errorCode, message);
  };
  if (!/^[0-9a-f]{64}$/.test(code)) failCode('CODE_INVALID', '', '인증 코드가 올바르지 않습니다.');
  const store = platform_().store;
  const hash = sha256Hex_(code);
  const doc = store.get(COL.AUTH_CODES, hash);
  if (!doc) failCode('CODE_INVALID', '', '인증 코드가 올바르지 않습니다.');
  if (doc.used) failCode('CODE_REUSED', doc.uid, '이미 사용된 인증 코드입니다. 포털에서 서비스를 다시 실행하세요.');
  if (doc.serviceId !== serviceId) failCode('CODE_WRONG_SERVICE', doc.uid, '다른 서비스용 인증 코드입니다.');
  if (t > doc.expiresAt) failCode('CODE_EXPIRED', doc.uid, '인증 코드가 만료되었습니다. 포털에서 서비스를 다시 실행하세요.');
  // 원자적 사용 처리: 문서 버전(updateTime) 전제조건으로 동시 요청 중 하나만 성공
  try {
    store.update(COL.AUTH_CODES, hash, { used: true, usedAt: t }, doc._v);
  } catch (e) {
    if (e.code === 'CONFLICT' || e.code === 'NOT_FOUND') failCode('CODE_REUSED', doc.uid, '이미 사용된 인증 코드입니다.');
    throw e;
  }
  const v = ssoValidate_(doc.uid, doc.sessionHash, serviceId, t);
  if (!v.ok) failCode(v.code, doc.uid, '서비스 이용 권한이 확인되지 않았습니다 (' + v.code + ').');
  logAccess_({ userId: v.user.uid, username: v.user.username, serviceId: serviceId, action: ACCESS_ACTIONS.SERVICE_AUTH_SUCCESS });
  try { store.update(COL.SERVICE_SECRETS, serviceId, { lastSsoSuccessAt: t }); } catch (e) { /* 무시 */ }
  return {
    user: ssoUserInfo_(v.user),
    serviceId: serviceId,
    sessionRef: doc.sessionHash,
    gatewaySessionExpiresAt: v.session.expiresAt,
    recheckIntervalSec: 300,
  };
}

function apiSsoCheck_(p) {
  const serviceId = cleanText_(p.serviceId, 64);
  verifyServiceKey_(serviceId, p.serviceKey);
  const v = ssoValidate_(cleanText_(p.uid, 128), cleanText_(p.sessionRef, 64), serviceId, now_());
  if (!v.ok) return { valid: false, reason: v.code };
  return { valid: true, user: ssoUserInfo_(v.user), gatewaySessionExpiresAt: v.session.expiresAt };
}
