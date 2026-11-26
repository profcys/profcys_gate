/**
 * PROFCYS Gateway API — 통합 로그인·세션·비밀번호 (8·9·23장)
 * 파일: apps-script/gateway-api/10_Auth.js
 *
 * 아이디 기반 로그인 구현 방식 ("서버 측 사용자 아이디 매핑 방식"):
 *  - Firebase Authentication 은 이메일/비밀번호 계정만 지원하므로, 사용자마다 추측 불가능한 내부 인증 이메일
 *    (예: u3f9a…@<projectId>.firebaseapp.com)을 무작위로 만들고 usernameMappings/{아이디} 에 서버 전용으로 저장한다.
 *  - 브라우저는 내부 인증 이메일을 알 수 없으므로 Firebase API 를 직접 호출하는 무차별 대입이 사실상 불가능하고,
 *    모든 로그인 시도는 이 서버의 실패 횟수 제한을 거친다.
 *  - 비밀번호는 Firebase Authentication(관리형 인증)만 처리하며 PROFCYS 데이터베이스·로그 어디에도 저장되지 않는다.
 *  - 로그인 성공 시 서버가 무작위 세션 토큰을 발급한다. DB 에는 토큰 원문이 아니라 SHA-256 해시만 저장한다.
 *  - 모든 보호된 요청은 서버에서 세션·계정 상태·기간·비밀번호 변경 여부·역할·서비스 권한을 다시 검증한다.
 */

/* ───────────── 세션 ───────────── */

function createSession_(user, meta) {
  const settings = getSettings_();
  const t = now_();
  const token = randomHex_(32);
  const hash = sha256Hex_(token);
  const maxHours = Math.min(24, Math.max(1, Number(settings.maximumSessionDuration) || 12));
  const idleMin = Math.min(480, Math.max(5, Number(settings.sessionTimeout) || 60));
  const session = {
    uid: user.uid,
    createdAt: t,
    lastActivityAt: t,
    expiresAt: t + maxHours * 3600000,
    idleTimeoutMin: idleMin,
    revoked: false,
    userAgent: cleanText_(meta && meta.userAgent, 160),
    ttlAt: new Date(t + maxHours * 3600000 + 86400000),
  };
  platform_().store.create(COL.SESSIONS, hash, session);
  return { token: token, hash: hash, session: session };
}

function sessionInfo_(session, settings) {
  return {
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    idleTimeoutMin: session.idleTimeoutMin,
    lastActivityAt: session.lastActivityAt,
    warningMinutes: Math.max(1, Number(settings.sessionWarningMinutes) || 5),
  };
}

function loadSession_(hash) {
  return cacheThrough_('s:' + hash, 300, function () {
    const d = platform_().store.get(COL.SESSIONS, hash);
    return d ? stripMeta_(d) : null;
  });
}

function revokeSession_(hash, reason) {
  try {
    platform_().store.update(COL.SESSIONS, hash, { revoked: true, revokedAt: now_(), revokeReason: reason || '' });
  } catch (e) {
    if (e.code !== 'NOT_FOUND') console.warn('revokeSession failed', e);
  }
  cacheInvalidate_('s:' + hash);
}

/**
 * 보호된 요청의 인증 컨텍스트 (10장 접근 권한 검증 우선순위 1~6단계)
 * @return {{user:Object, session:Object, sessionHash:string, now:number, settings:Object}}
 */
function requireAuth_(token, action) {
  if (!token || typeof token !== 'string' || token.length < 32 || token.length > 128) fail_('AUTH_REQUIRED', '로그인이 필요합니다.');
  const hash = sha256Hex_(token);
  const session = loadSession_(hash);
  if (!session || session.revoked) fail_('SESSION_INVALID', '로그인 세션이 유효하지 않습니다. 다시 로그인하세요.');
  const t = now_();
  if (t > session.expiresAt) {
    revokeSession_(hash, 'MAX_DURATION');
    logAccess_({ userId: session.uid, action: ACCESS_ACTIONS.SESSION_EXPIRED, result: 'EXPIRED', errorCode: 'MAX_DURATION' });
    fail_('SESSION_EXPIRED', '최대 로그인 시간이 지나 자동 로그아웃되었습니다. 다시 로그인하세요.');
  }
  if (t - session.lastActivityAt > session.idleTimeoutMin * 60000) {
    revokeSession_(hash, 'IDLE');
    logAccess_({ userId: session.uid, action: ACCESS_ACTIONS.SESSION_EXPIRED, result: 'EXPIRED', errorCode: 'IDLE_TIMEOUT' });
    fail_('SESSION_EXPIRED', '장시간 사용하지 않아 자동 로그아웃되었습니다. 다시 로그인하세요.');
  }
  const user = getUser_(session.uid);
  if (!user) { revokeSession_(hash, 'USER_DELETED'); fail_('SESSION_INVALID', '계정을 찾을 수 없습니다.'); }
  if (user.sessionsValidAfter && session.createdAt < user.sessionsValidAfter) {
    revokeSession_(hash, 'REVOKED');
    fail_('SESSION_REVOKED', '보안 정책에 따라 로그인 세션이 종료되었습니다. 다시 로그인하세요.');
  }
  const problem = accountProblem_(user, t);
  if (problem) {
    revokeSession_(hash, problem);
    fail_(problem, accountProblemMessage_(problem));
  }
  const settings = getSettings_();
  if (user.mustChangePassword && ACTIONS_ALLOWED_BEFORE_PASSWORD_CHANGE.indexOf(action) < 0) {
    fail_('PASSWORD_CHANGE_REQUIRED', '초기 비밀번호를 변경한 후 이용할 수 있습니다.');
  }
  if (settings.maintenanceMode && user.role === ROLES.USER && ['logout', 'sync', 'session', 'touch'].indexOf(action) < 0) {
    fail_('PLATFORM_MAINTENANCE', settings.maintenanceMessage || '플랫폼 점검 중입니다. 잠시 후 이용하세요.');
  }
  // 활성 시간 갱신 (백그라운드 동기화 요청은 활동으로 보지 않는다). 쓰기 횟수 절약을 위해 2분 단위로 기록.
  if (action !== 'sync' && t - session.lastActivityAt > 120000) {
    session.lastActivityAt = t;
    try { platform_().store.update(COL.SESSIONS, hash, { lastActivityAt: t }); } catch (e) { console.warn('touch failed', e); }
    cacheInvalidate_('s:' + hash);
  }
  return { user: user, session: session, sessionHash: hash, now: t, settings: settings };
}

function accountProblemMessage_(code) {
  return {
    ACCOUNT_DISABLED: '비활성화된 계정입니다. 관리자에게 문의하세요.',
    ACCOUNT_NOT_STARTED: '계정 사용 시작일 이전입니다. 관리자에게 문의하세요.',
    ACCOUNT_EXPIRED: '계정 사용 기간이 만료되었습니다. 관리자에게 문의하세요.',
    ACCOUNT_LOCKED: '로그인 실패가 반복되어 계정이 일시적으로 잠겼습니다. 잠시 후 다시 시도하세요.',
    ACCOUNT_NOT_FOUND: '계정을 찾을 수 없습니다.',
  }[code] || '계정을 사용할 수 없습니다.';
}

function requireRole_(ctx, roles) {
  if (roles.indexOf(ctx.user.role) < 0) {
    logAccess_({ userId: ctx.user.uid, username: ctx.user.username, action: ACCESS_ACTIONS.ACCESS_DENIED, result: 'DENIED', errorCode: 'ADMIN_REQUIRED' });
    fail_('FORBIDDEN', '이 기능을 사용할 권한이 없습니다.');
  }
}

function requireAdmin_(ctx) { requireRole_(ctx, [ROLES.SUPER_ADMIN, ROLES.ADMIN]); }
function requireSuperAdmin_(ctx) { requireRole_(ctx, [ROLES.SUPER_ADMIN]); }

/** 주요 권한 변경 시 관리자 재인증 (9장 최고관리자 보호) */
function requireReauth_(ctx, password) {
  if (!password) fail_('REAUTH_REQUIRED', '보안을 위해 현재 관리자 비밀번호를 다시 입력하세요.');
  const mapping = platform_().store.get(COL.USERNAME_MAPPINGS, ctx.user.normalizedUsername);
  if (!mapping) fail_('REAUTH_FAILED', '재인증에 실패했습니다.');
  const r = platform_().auth.verifyPassword(mapping.authEmail, password);
  if (!r.ok || r.uid !== ctx.user.uid) {
    logAdmin_(ctx.user, 'REAUTH_FAILED', { result: 'FAILURE' });
    fail_('REAUTH_FAILED', '비밀번호가 올바르지 않습니다.');
  }
}

/* ───────────── 로그인 실패 제한 ───────────── */

function guardKey_(normalized) {
  return sha256Hex_('guard:' + normalized).substring(0, 40);
}

function checkGuard_(key, t) {
  const g = platform_().store.get(COL.LOGIN_GUARDS, key);
  if (g && g.lockedUntil && t < g.lockedUntil) {
    const min = Math.ceil((g.lockedUntil - t) / 60000);
    fail_('LOGIN_LOCKED', '로그인 실패가 반복되어 ' + min + '분 동안 로그인이 제한됩니다.', { retryAfterMinutes: min });
  }
  return g;
}

function recordGuardFailure_(key, g, t, settings) {
  const windowMs = 15 * 60000;
  const max = Math.max(3, Number(settings.loginMaxAttempts) || 5);
  const lockMs = Math.max(1, Number(settings.loginLockMinutes) || 15) * 60000;
  let failures = 1;
  let windowStart = t;
  if (g && g.windowStart && t - g.windowStart < windowMs) { failures = (g.failures || 0) + 1; windowStart = g.windowStart; }
  const data = { failures: failures, windowStart: windowStart, lastFailureAt: t, lockedUntil: failures >= max ? t + lockMs : 0, ttlAt: new Date(t + 86400000) };
  platform_().store.set(COL.LOGIN_GUARDS, key, data);
  return { failures: failures, remaining: Math.max(0, max - failures), locked: failures >= max };
}

/* ───────────── 공개 API: 로그인 ───────────── */

function apiLogin_(params, meta) {
  const username = normalizeUsername_(params.username);
  const password = String(params.password == null ? '' : params.password);
  if (!username || !password) fail_('INVALID_INPUT', '아이디와 비밀번호를 입력하세요.');
  if (username.length > 64 || password.length > 256) fail_('INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
  const t = now_();
  const settings = getSettings_();
  const store = platform_().store;
  const key = guardKey_(username);
  const guard = checkGuard_(key, t);

  const mapping = USERNAME_PATTERN.test(username) ? store.get(COL.USERNAME_MAPPINGS, username) : null;
  let verified = null;
  if (mapping) verified = platform_().auth.verifyPassword(mapping.authEmail, password);
  else platform_().auth.verifyPassword(authEmailFor_('x' + randomHex_(8)), password); // 존재 여부를 응답 시간으로 추측하지 못하도록 동일한 호출 수행
  if (!mapping || !verified.ok) {
    const reason = verified && verified.reason;
    if (reason === 'ERROR') fail_('AUTH_ERROR', '인증 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도하세요.');
    const g = recordGuardFailure_(key, guard, t, settings);
    logAccess_({ userId: mapping ? mapping.uid : '', username: username, action: ACCESS_ACTIONS.LOGIN_FAILURE, result: 'FAILURE', errorCode: reason === 'TOO_MANY' ? 'AUTH_THROTTLED' : (reason === 'DISABLED' ? 'AUTH_DISABLED' : 'INVALID_CREDENTIALS') });
    if (reason === 'DISABLED') fail_('ACCOUNT_DISABLED', accountProblemMessage_('ACCOUNT_DISABLED'));
    if (g.locked || reason === 'TOO_MANY') fail_('LOGIN_LOCKED', '로그인 실패가 반복되어 ' + (Number(settings.loginLockMinutes) || 15) + '분 동안 로그인이 제한됩니다.');
    fail_('INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.', { remainingAttempts: g.remaining });
  }
  if (guard) store.remove(COL.LOGIN_GUARDS, key);

  const user = getUser_(mapping.uid);
  const problem = accountProblem_(user, t);
  if (problem) {
    logAccess_({ userId: mapping.uid, username: username, action: ACCESS_ACTIONS.LOGIN_FAILURE, result: 'DENIED', errorCode: problem });
    fail_(problem, accountProblemMessage_(problem));
  }
  if (settings.maintenanceMode && user.role === ROLES.USER) {
    fail_('PLATFORM_MAINTENANCE', settings.maintenanceMessage || '플랫폼 점검 중입니다. 잠시 후 이용하세요.');
  }
  const created = createSession_(user, meta);
  store.update(COL.USERS, user.uid, { lastLoginAt: t, previousLoginAt: user.lastLoginAt || null });
  invalidateUser_(user.uid);
  logAccess_({ userId: user.uid, username: user.username, action: ACCESS_ACTIONS.LOGIN_SUCCESS });
  const fresh = Object.assign({}, user, { lastLoginAt: t, previousLoginAt: user.lastLoginAt || null });
  return {
    token: created.token,
    user: publicUser_(fresh),
    session: sessionInfo_(created.session, settings),
    mustChangePassword: !!user.mustChangePassword,
    rev: getRevision_(),
  };
}

function apiLogout_(ctx) {
  revokeSession_(ctx.sessionHash, 'LOGOUT');
  logAccess_({ userId: ctx.user.uid, username: ctx.user.username, action: ACCESS_ACTIONS.LOGOUT });
  return { loggedOut: true };
}

function apiSession_(ctx) {
  return {
    user: publicUser_(ctx.user),
    session: sessionInfo_(ctx.session, ctx.settings),
    mustChangePassword: !!ctx.user.mustChangePassword,
    platform: publicPlatformInfo_(ctx.settings),
    rev: getRevision_(),
    serverTime: ctx.now,
  };
}

function publicPlatformInfo_(settings) {
  return {
    platformName: settings.platformName,
    platformNameEn: settings.platformNameEn,
    supportContact: settings.supportContact,
    maintenanceMode: !!settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage || '',
    copyright: settings.copyright,
    passwordMinLength: settings.passwordMinLength,
  };
}

/** 로그인 전 화면에 필요한 공개 정보 (민감 정보 없음) */
function apiPublicInfo_() {
  const settings = getSettings_();
  const system = loadCatalog_().system || {};
  return {
    platform: publicPlatformInfo_(settings),
    initialized: !!system.bootstrappedAt,
    setupEnabled: !system.bootstrappedAt && !!platform_().props.get('SETUP_TOKEN'),
    recoveryEnabled: !!platform_().props.get('RECOVERY_TOKEN'),
    apiVersion: PROFCYS.API_VERSION,
  };
}

/* ───────────── 비밀번호 변경 (본인) ───────────── */

function apiChangePassword_(ctx, params, meta) {
  const current = String(params.currentPassword || '');
  const next = String(params.newPassword || '');
  if (!current || !next) fail_('INVALID_INPUT', '현재 비밀번호와 새 비밀번호를 입력하세요.');
  if (current === next) fail_('WEAK_PASSWORD', '새 비밀번호는 현재 비밀번호와 달라야 합니다.');
  assertPasswordPolicy_(next, { minLength: ctx.settings.passwordMinLength, username: ctx.user.username });
  const store = platform_().store;
  const mapping = store.get(COL.USERNAME_MAPPINGS, ctx.user.normalizedUsername);
  const r = mapping ? platform_().auth.verifyPassword(mapping.authEmail, current) : { ok: false };
  if (!r.ok) {
    logAccess_({ userId: ctx.user.uid, username: ctx.user.username, action: ACCESS_ACTIONS.PASSWORD_CHANGE, result: 'FAILURE', errorCode: 'INVALID_CURRENT_PASSWORD' });
    fail_('INVALID_CURRENT_PASSWORD', '현재 비밀번호가 올바르지 않습니다.');
  }
  platform_().auth.setPassword(ctx.user.uid, next);
  const t = now_();
  // 다른 모든 세션 폐기 후 현재 사용자에게 새 세션 발급
  store.update(COL.USERS, ctx.user.uid, { mustChangePassword: false, passwordChangedAt: t, sessionsValidAfter: t, updatedAt: t });
  invalidateUser_(ctx.user.uid);
  revokeSession_(ctx.sessionHash, 'PASSWORD_CHANGED');
  const user = getUser_(ctx.user.uid);
  const created = createSession_(user, meta);
  logAccess_({ userId: user.uid, username: user.username, action: ACCESS_ACTIONS.PASSWORD_CHANGE });
  return { token: created.token, user: publicUser_(user), session: sessionInfo_(created.session, ctx.settings), mustChangePassword: false };
}

/* ───────────── 최초 관리자 설정 (9장) ───────────── */

/**
 * 최초 최고관리자(profcys) 생성. 조건:
 *  1) 스크립트 소유자가 Apps Script 편집기에서 enableInitialSetup() 을 실행해 일회용 설정 토큰을 발급했어야 한다.
 *  2) 아직 최고관리자가 만들어지지 않았어야 한다 (이미 있으면 중복 생성·비밀번호 초기화를 하지 않는다).
 * 비밀번호는 Firebase Authentication 으로만 전달되고 어디에도 저장되지 않는다.
 */
function apiBootstrap_(params) {
  const props = platform_().props;
  const t = now_();
  const key = guardKey_('#setup');
  const guard = checkGuard_(key, t);
  const expected = props.get('SETUP_TOKEN');
  const expires = Number(props.get('SETUP_TOKEN_EXPIRES') || 0);
  if (!expected || (expires && t > expires)) fail_('SETUP_DISABLED', '초기 설정이 활성화되어 있지 않습니다. 설치 가이드의 enableInitialSetup 단계를 확인하세요.');
  if (!safeEqual_(params.setupToken, expected)) {
    recordGuardFailure_(key, guard, t, getSettings_());
    fail_('SETUP_TOKEN_INVALID', '설정 토큰이 올바르지 않습니다.');
  }
  const password = String(params.password || '');
  assertPasswordPolicy_(password, { minLength: 12, username: PROFCYS.INITIAL_ADMIN_USERNAME });

  return platform_().lock.withLock(function () {
    const store = platform_().store;
    if (store.get(COL.USERNAME_MAPPINGS, PROFCYS.INITIAL_ADMIN_USERNAME)) {
      props.remove('SETUP_TOKEN');
      fail_('ALREADY_INITIALIZED', '최초 관리자 계정이 이미 존재합니다. 기존 비밀번호는 변경되지 않았습니다.');
    }
    const seeded = seedDatabase_('bootstrap');
    const uid = createUserRecord_({
      username: PROFCYS.INITIAL_ADMIN_USERNAME,
      displayName: cleanText_(params.displayName, 50) || PROFCYS.INITIAL_ADMIN_DISPLAY_NAME,
      role: ROLES.SUPER_ADMIN,
      status: ACCOUNT_STATUS.ACTIVE,
      mustChangePassword: true, // 9장: 최초 로그인 시 비밀번호 변경 요구
      organization: 'PROFCYS',
      allowedServices: [],
      memo: '최초 최고관리자 (초기 설정 절차로 생성)',
    }, password, 'bootstrap');
    store.upsert(COL.SETTINGS, 'system', { bootstrappedAt: t, bootstrappedBy: uid, schemaVersion: 3 });
    props.remove('SETUP_TOKEN');
    props.remove('SETUP_TOKEN_EXPIRES');
    bumpRevision_();
    logAdmin_({ uid: uid, username: PROFCYS.INITIAL_ADMIN_USERNAME }, 'BOOTSTRAP_SUPER_ADMIN', { targetUserId: uid, targetUsername: PROFCYS.INITIAL_ADMIN_USERNAME, changeSummary: '최초 최고관리자 생성, 초기 데이터 ' + seeded.created.length + '건 생성' });
    return { created: true, username: PROFCYS.INITIAL_ADMIN_USERNAME, seeded: seeded.created.length };
  });
}

/**
 * 관리자 계정 분실 시 복구 (9장). 스크립트 소유자만 편집기에서 enableAdminRecovery() 로 일회용 복구 토큰을 발급할 수 있다.
 */
function apiRecoverAdmin_(params) {
  const props = platform_().props;
  const t = now_();
  const key = guardKey_('#recovery');
  const guard = checkGuard_(key, t);
  const expected = props.get('RECOVERY_TOKEN');
  const expires = Number(props.get('RECOVERY_TOKEN_EXPIRES') || 0);
  if (!expected || (expires && t > expires)) fail_('RECOVERY_DISABLED', '관리자 복구가 활성화되어 있지 않습니다.');
  if (!safeEqual_(params.recoveryToken, expected)) {
    recordGuardFailure_(key, guard, t, getSettings_());
    fail_('RECOVERY_TOKEN_INVALID', '복구 토큰이 올바르지 않습니다.');
  }
  const username = normalizeUsername_(params.username || PROFCYS.INITIAL_ADMIN_USERNAME);
  const password = String(params.newPassword || '');
  assertPasswordPolicy_(password, { minLength: 12, username: username });
  const store = platform_().store;
  const mapping = store.get(COL.USERNAME_MAPPINGS, username);
  const user = mapping && getUser_(mapping.uid);
  if (!user || user.role !== ROLES.SUPER_ADMIN) fail_('RECOVERY_TARGET_INVALID', '최고관리자 계정만 복구할 수 있습니다.');
  platform_().auth.setPassword(user.uid, password);
  platform_().auth.setDisabled(user.uid, false);
  store.update(COL.USERS, user.uid, { status: ACCOUNT_STATUS.ACTIVE, mustChangePassword: true, sessionsValidAfter: t, lockedUntil: 0, updatedAt: t });
  store.remove(COL.LOGIN_GUARDS, guardKey_(username));
  invalidateUser_(user.uid);
  props.remove('RECOVERY_TOKEN');
  props.remove('RECOVERY_TOKEN_EXPIRES');
  logAdmin_({ uid: 'owner', username: 'script-owner' }, 'ADMIN_RECOVERY', { targetUserId: user.uid, targetUsername: username, changeSummary: '스크립트 소유자 복구 토큰으로 최고관리자 비밀번호 재설정' });
  return { recovered: true, username: username };
}
