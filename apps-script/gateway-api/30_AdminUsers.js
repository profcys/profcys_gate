/**
 * PROFCYS Gateway API — 사용자 계정 관리 (12·13장)
 * 파일: apps-script/gateway-api/30_AdminUsers.js
 */

function authEmailFor_(localPart) {
  const props = platform_().props;
  const domain = props.get('AUTH_EMAIL_DOMAIN') || ((props.get('FIREBASE_PROJECT_ID') || 'profcys') + '.firebaseapp.com');
  return localPart + '@' + domain;
}

const EMAIL_PATTERN_ = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
const PHONE_PATTERN_ = /^[0-9+\-() ]{0,30}$/;

/**
 * 입력값 검증·정리. 반환 객체에는 변경 가능한 필드만 포함된다.
 */
function sanitizeUserFields_(p, opts) {
  opts = opts || {};
  const out = {};
  const services = loadCatalog_().services;
  const knownIds = services.map(function (s) { return s.serviceId; });
  if (p.displayName !== undefined || opts.create) {
    out.displayName = cleanText_(p.displayName, 50);
    if (!out.displayName) fail_('INVALID_INPUT', '사용자 이름을 입력하세요.');
  }
  ['organization', 'department', 'position'].forEach(function (k) { if (p[k] !== undefined) out[k] = cleanText_(p[k], 100); });
  if (p.email !== undefined) {
    out.email = cleanText_(p.email, 120);
    if (out.email && !EMAIL_PATTERN_.test(out.email)) fail_('INVALID_INPUT', '이메일 형식이 올바르지 않습니다.');
  }
  if (p.phone !== undefined) {
    out.phone = cleanText_(p.phone, 30);
    if (!PHONE_PATTERN_.test(out.phone)) fail_('INVALID_INPUT', '연락처 형식이 올바르지 않습니다.');
  }
  if (p.role !== undefined || opts.create) {
    out.role = p.role || ROLES.USER;
    if (ROLE_LIST.indexOf(out.role) < 0) fail_('INVALID_INPUT', '사용자 역할이 올바르지 않습니다.');
  }
  if (p.status !== undefined || opts.create) {
    out.status = p.status === ACCOUNT_STATUS.INACTIVE ? ACCOUNT_STATUS.INACTIVE : ACCOUNT_STATUS.ACTIVE;
  }
  ['validFrom', 'validUntil'].forEach(function (k) {
    if (p[k] !== undefined) {
      if (!isValidDateStr_(p[k])) fail_('INVALID_INPUT', '날짜 형식(YYYY-MM-DD)이 올바르지 않습니다.');
      out[k] = p[k] || '';
    }
  });
  const from = out.validFrom !== undefined ? out.validFrom : (opts.existing && opts.existing.validFrom);
  const until = out.validUntil !== undefined ? out.validUntil : (opts.existing && opts.existing.validUntil);
  if (from && until && kstDayStartMs_(until) < kstDayStartMs_(from)) fail_('INVALID_INPUT', '계정 사용 종료일은 시작일 이후여야 합니다.');
  ['allowedServices', 'delegatedServices'].forEach(function (k) {
    if (p[k] !== undefined) {
      out[k] = cleanList_(p[k], 500, 64);
      const unknown = out[k].filter(function (id) { return knownIds.indexOf(id) < 0; });
      if (unknown.length) fail_('INVALID_INPUT', '존재하지 않는 서비스 ID: ' + unknown.join(', '));
    }
  });
  if (p.groups !== undefined) out.groups = cleanList_(p.groups, 30, 50);
  if (p.memo !== undefined) out.memo = cleanText_(p.memo, 1000);
  return out;
}

/**
 * Firebase 인증 계정 + users + usernameMappings 생성. 실패 시 인증 계정을 롤백한다.
 * @return {string} uid
 */
function createUserRecord_(fields, password, actorUid) {
  const store = platform_().store;
  const normalized = normalizeUsername_(fields.username);
  validateUsername_(normalized);
  if (store.get(COL.USERNAME_MAPPINGS, normalized)) fail_('USERNAME_TAKEN', '이미 사용 중인 아이디입니다.');
  const authEmail = authEmailFor_('u' + randomHex_(10));
  const created = platform_().auth.createAccount(authEmail, password, fields.displayName);
  const uid = created.uid;
  const t = now_();
  const user = {
    username: normalized,
    normalizedUsername: normalized,
    displayName: fields.displayName,
    organization: fields.organization || '',
    department: fields.department || '',
    position: fields.position || '',
    email: fields.email || '',
    phone: fields.phone || '',
    role: fields.role,
    status: fields.status || ACCOUNT_STATUS.ACTIVE,
    groups: fields.groups || [],
    allowedServices: fields.allowedServices || [],
    delegatedServices: fields.role === ROLES.ADMIN ? (fields.delegatedServices || []) : [],
    mustChangePassword: fields.mustChangePassword !== false,
    validFrom: fields.validFrom || '',
    validUntil: fields.validUntil || '',
    memo: fields.memo || '',
    sessionsValidAfter: 0,
    lockedUntil: 0,
    createdAt: t,
    createdBy: actorUid || '',
    updatedAt: t,
    lastLoginAt: null,
    passwordChangedAt: t,
  };
  try {
    store.commit([
      { type: 'create', col: COL.USERNAME_MAPPINGS, id: normalized, data: { normalizedUsername: normalized, uid: uid, authEmail: authEmail, createdAt: t } },
      { type: 'create', col: COL.USERS, id: uid, data: user },
    ]);
  } catch (e) {
    try { platform_().auth.deleteAccount(uid); } catch (ignore) { /* 롤백 실패는 로그만 */ console.error('rollback failed', uid); }
    if (e.code === 'CONFLICT') fail_('USERNAME_TAKEN', '이미 사용 중인 아이디입니다.');
    throw e;
  }
  if (user.status === ACCOUNT_STATUS.INACTIVE) platform_().auth.setDisabled(uid, true);
  invalidateUser_(uid);
  return uid;
}

function activeSuperAdminCount_() {
  return listAllUsers_().filter(function (u) { return u.role === ROLES.SUPER_ADMIN && u.status === ACCOUNT_STATUS.ACTIVE; }).length;
}

function loadManageableUser_(ctx, uid) {
  const target = getUser_(cleanText_(uid, 128));
  if (!target) fail_('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
  if (!canManageUser_(ctx.user, target)) {
    logAccess_({ userId: ctx.user.uid, username: ctx.user.username, action: ACCESS_ACTIONS.ACCESS_DENIED, result: 'DENIED', errorCode: 'USER_MANAGE_FORBIDDEN', detail: target.uid });
    fail_('FORBIDDEN', '이 사용자를 관리할 권한이 없습니다.');
  }
  return target;
}

function adminUserView_(u) {
  return Object.assign(publicUser_(u), { memo: u.memo || '', lockedUntil: u.lockedUntil || 0 });
}

/* ───────────── 조회 ───────────── */

function apiUsersList_(ctx, p) {
  requireAdmin_(ctx);
  p = p || {};
  let users = listAllUsers_();
  if (ctx.user.role === ROLES.ADMIN) users = users.filter(function (u) { return u.role === ROLES.USER || u.uid === ctx.user.uid; });
  const organizations = {};
  const groups = {};
  users.forEach(function (u) {
    if (u.organization) organizations[u.organization] = 1;
    (u.groups || []).forEach(function (g) { groups[g] = 1; });
  });
  const q = cleanText_(p.query, 100).toLowerCase();
  const t = now_();
  const filtered = users.filter(function (u) {
    if (q) {
      const field = p.field || 'all';
      const hay = field === 'name' ? u.displayName : field === 'username' ? u.username : field === 'organization' ? u.organization :
        [u.displayName, u.username, u.organization, u.department, u.email].join(' ');
      if (String(hay || '').toLowerCase().indexOf(q) < 0) return false;
    }
    if (p.role && u.role !== p.role) return false;
    if (p.status && u.status !== p.status) return false;
    if (p.organization && u.organization !== p.organization) return false;
    if (p.group && (u.groups || []).indexOf(p.group) < 0) return false;
    if (p.serviceId) {
      const s = findService_(p.serviceId);
      if (!s || !hasServicePermission_(u, s)) return false;
    }
    if (p.expiringDays) {
      const until = kstDayEndMs_(u.validUntil);
      if (until == null || until < t || until > t + Number(p.expiringDays) * 86400000) return false;
    }
    return true;
  });
  const sort = p.sort || 'createdAt';
  const dir = p.dir === 'asc' ? 1 : -1;
  filtered.sort(function (a, b) {
    const av = sort === 'name' ? a.displayName : sort === 'username' ? a.username : (a[sort] || 0);
    const bv = sort === 'name' ? b.displayName : sort === 'username' ? b.username : (b[sort] || 0);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  const pageSize = Math.min(200, Math.max(5, Number(p.pageSize) || 20));
  const page = Math.max(1, Number(p.page) || 1);
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map(adminUserView_),
    total: filtered.length,
    page: page,
    pageSize: pageSize,
    organizations: Object.keys(organizations).sort(),
    groups: Object.keys(groups).sort(),
  };
}

function apiUsersGet_(ctx, p) {
  requireAdmin_(ctx);
  const u = loadManageableUser_(ctx, p.uid);
  return { user: adminUserView_(u) };
}

/** 내보내기용 전체 목록 (비밀번호·인증정보 미포함) */
function apiUsersExport_(ctx) {
  requireAdmin_(ctx);
  let users = listAllUsers_();
  if (ctx.user.role === ROLES.ADMIN) users = users.filter(function (u) { return u.role === ROLES.USER; });
  return { items: users.map(publicUser_) };
}

/* ───────────── 등록 ───────────── */

function apiUsersCreate_(ctx, p) {
  requireAdmin_(ctx);
  const fields = sanitizeUserFields_(p, { create: true });
  fields.username = p.username;
  if (!canAssignRole_(ctx.user, fields.role)) fail_('FORBIDDEN', '해당 역할을 부여할 권한이 없습니다.');
  if (fields.role !== ROLES.USER) requireReauth_(ctx, p.reauthPassword);
  const outside = servicesOutsideDelegation_(ctx.user, [], fields.allowedServices || []);
  if (outside.length) fail_('FORBIDDEN', '위임받지 않은 서비스 권한은 부여할 수 없습니다: ' + outside.join(', '));
  if (fields.delegatedServices && fields.delegatedServices.length && ctx.user.role !== ROLES.SUPER_ADMIN) fail_('FORBIDDEN', '서비스 관리 위임은 최고관리자만 설정할 수 있습니다.');
  const normalized = normalizeUsername_(p.username);
  if (RESERVED_USERNAMES.indexOf(normalized) >= 0 || normalized === PROFCYS.INITIAL_ADMIN_USERNAME) fail_('USERNAME_RESERVED', '예약된 아이디는 사용할 수 없습니다.');
  let password = p.password ? String(p.password) : '';
  let generated = false;
  if (!password || p.generatePassword) { password = generateTemporaryPassword_(16); generated = true; }
  assertPasswordPolicy_(password, { minLength: ctx.settings.passwordMinLength, username: normalized });
  fields.mustChangePassword = true; // 신규 계정은 최초 로그인 시 비밀번호 변경 필수
  const uid = createUserRecord_(fields, password, ctx.user.uid);
  logAdmin_(ctx.user, 'USER_CREATE', {
    targetUserId: uid, targetUsername: normalized,
    changeSummary: '역할 ' + fields.role + ', 서비스 권한 ' + (fields.allowedServices || []).length + '개' + (generated ? ', 임시 비밀번호 자동 생성' : ', 관리자 지정 비밀번호'),
  });
  if ((fields.allowedServices || []).length) bumpRevision_();
  const result = { user: adminUserView_(getUser_(uid)) };
  if (generated) result.temporaryPassword = password; // 이 응답에서 한 번만 표시 (저장·재조회 불가)
  return result;
}

/** CSV 일괄 등록: 각 행마다 임시 비밀번호를 자동 생성하여 한 번만 반환 */
function apiUsersImport_(ctx, p) {
  requireAdmin_(ctx);
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 200) : [];
  if (!rows.length) fail_('INVALID_INPUT', '등록할 사용자가 없습니다.');
  const results = [];
  rows.forEach(function (row, i) {
    try {
      if (row.role && row.role !== ROLES.USER) fail_('FORBIDDEN', 'CSV 일괄 등록은 일반 사용자(USER)만 가능합니다.');
      const r = apiUsersCreate_(ctx, Object.assign({}, row, { role: ROLES.USER, generatePassword: true, password: '' }));
      results.push({ row: i + 1, username: r.user.username, ok: true, temporaryPassword: r.temporaryPassword });
    } catch (e) {
      results.push({ row: i + 1, username: String(row.username || ''), ok: false, error: e.code || 'ERROR', message: e.message });
    }
  });
  logAdmin_(ctx.user, 'USER_BULK_IMPORT', { changeSummary: '일괄 등록 ' + results.filter(function (r) { return r.ok; }).length + '/' + rows.length + '건' });
  return { results: results };
}

/* ───────────── 수정 ───────────── */

function apiUsersUpdate_(ctx, p) {
  requireAdmin_(ctx);
  const target = loadManageableUser_(ctx, p.uid);
  const patch = sanitizeUserFields_(p.patch || {}, { existing: target });
  const self = target.uid === ctx.user.uid;
  const store = platform_().store;

  if (patch.role !== undefined && patch.role !== target.role) {
    if (self) fail_('FORBIDDEN', '자신의 역할은 변경할 수 없습니다.');
    if (!canAssignRole_(ctx.user, patch.role)) fail_('FORBIDDEN', '해당 역할을 부여할 권한이 없습니다.');
    requireReauth_(ctx, p.reauthPassword);
    if (target.role === ROLES.SUPER_ADMIN && activeSuperAdminCount_() <= 1) fail_('LAST_SUPER_ADMIN', '마지막 최고관리자의 역할은 변경할 수 없습니다.');
  } else {
    delete patch.role;
  }
  if (patch.status !== undefined && patch.status !== target.status) {
    if (self) fail_('FORBIDDEN', '자신의 계정 상태는 변경할 수 없습니다.');
    if (target.role === ROLES.SUPER_ADMIN && patch.status === ACCOUNT_STATUS.INACTIVE && activeSuperAdminCount_() <= 1) {
      fail_('LAST_SUPER_ADMIN', '마지막 최고관리자 계정은 비활성화할 수 없습니다.');
    }
  } else {
    delete patch.status;
  }
  if (patch.allowedServices !== undefined) {
    const outside = servicesOutsideDelegation_(ctx.user, target.allowedServices || [], patch.allowedServices);
    if (outside.length) fail_('FORBIDDEN', '위임받지 않은 서비스 권한은 변경할 수 없습니다: ' + outside.join(', '));
  }
  if (patch.delegatedServices !== undefined) {
    if (ctx.user.role !== ROLES.SUPER_ADMIN) fail_('FORBIDDEN', '서비스 관리 위임은 최고관리자만 변경할 수 있습니다.');
    if ((patch.role || target.role) !== ROLES.ADMIN) patch.delegatedServices = [];
  }
  if (patch.role !== undefined && patch.role !== ROLES.ADMIN) patch.delegatedServices = [];

  const changed = changedKeys_(target, Object.assign({}, target, patch));
  if (!changed.length) return { user: adminUserView_(target), changed: [] };
  const t = now_();
  patch.updatedAt = t;
  patch.updatedBy = ctx.user.uid;
  const revokes = changed.indexOf('role') >= 0 || (changed.indexOf('status') >= 0 && patch.status === ACCOUNT_STATUS.INACTIVE);
  if (revokes) patch.sessionsValidAfter = t + 1; // 역할 변경·계정 정지 시 기존 세션 폐기
  store.update(COL.USERS, target.uid, patch);
  if (changed.indexOf('status') >= 0) platform_().auth.setDisabled(target.uid, patch.status === ACCOUNT_STATUS.INACTIVE);
  invalidateUser_(target.uid);

  const summary = changed.map(function (k) {
    if (k === 'allowedServices') return '서비스 권한(' + (target.allowedServices || []).length + '→' + patch.allowedServices.length + ')';
    if (k === 'role') return '역할(' + target.role + '→' + patch.role + ')';
    if (k === 'status') return '상태(' + target.status + '→' + patch.status + ')';
    if (k === 'memo' || k === 'phone' || k === 'email') return k;
    return k;
  }).join(', ');
  const action = changed.indexOf('role') >= 0 ? 'USER_ROLE_CHANGE' : changed.indexOf('allowedServices') >= 0 ? 'USER_PERMISSION_CHANGE' :
    changed.indexOf('status') >= 0 ? 'USER_STATUS_CHANGE' : 'USER_UPDATE';
  logAdmin_(ctx.user, action, { targetUserId: target.uid, targetUsername: target.username, changeSummary: summary });
  if (changed.indexOf('status') >= 0) {
    logAccess_({ userId: target.uid, username: target.username, action: ACCESS_ACTIONS.ACCOUNT_STATUS_CHANGE, result: patch.status, detail: 'by ' + ctx.user.username });
  }
  if (['allowedServices', 'role', 'status', 'groups', 'organization', 'delegatedServices'].some(function (k) { return changed.indexOf(k) >= 0; })) bumpRevision_();
  return { user: adminUserView_(getUser_(target.uid)), changed: changed };
}

/* ───────────── 비밀번호 초기화 ───────────── */

function apiUsersResetPassword_(ctx, p) {
  requireAdmin_(ctx);
  const target = loadManageableUser_(ctx, p.uid);
  if (target.uid === ctx.user.uid) fail_('FORBIDDEN', '본인 비밀번호는 [계정 설정 > 비밀번호 변경]에서 변경하세요.');
  if (target.role !== ROLES.USER) requireReauth_(ctx, p.reauthPassword);
  let password = p.password ? String(p.password) : '';
  let generated = false;
  if (!password || p.generatePassword) { password = generateTemporaryPassword_(16); generated = true; }
  assertPasswordPolicy_(password, { minLength: ctx.settings.passwordMinLength, username: target.username });
  platform_().auth.setPassword(target.uid, password);
  const t = now_();
  platform_().store.update(COL.USERS, target.uid, { mustChangePassword: true, sessionsValidAfter: t + 1, lockedUntil: 0, passwordChangedAt: t, updatedAt: t, updatedBy: ctx.user.uid });
  platform_().store.remove(COL.LOGIN_GUARDS, guardKey_(target.normalizedUsername));
  invalidateUser_(target.uid);
  logAdmin_(ctx.user, 'USER_PASSWORD_RESET', { targetUserId: target.uid, targetUsername: target.username, changeSummary: generated ? '임시 비밀번호 자동 생성' : '관리자 지정 비밀번호' });
  const r = { reset: true };
  if (generated) r.temporaryPassword = password;
  return r;
}

function apiUsersUnlock_(ctx, p) {
  requireAdmin_(ctx);
  const target = loadManageableUser_(ctx, p.uid);
  platform_().store.remove(COL.LOGIN_GUARDS, guardKey_(target.normalizedUsername));
  platform_().store.update(COL.USERS, target.uid, { lockedUntil: 0 });
  invalidateUser_(target.uid);
  logAdmin_(ctx.user, 'USER_UNLOCK', { targetUserId: target.uid, targetUsername: target.username });
  return { unlocked: true };
}

/** 강제 로그아웃 (모든 세션 폐기) */
function apiUsersRevokeSessions_(ctx, p) {
  requireAdmin_(ctx);
  const target = loadManageableUser_(ctx, p.uid);
  platform_().store.update(COL.USERS, target.uid, { sessionsValidAfter: now_() + 1 });
  invalidateUser_(target.uid);
  logAdmin_(ctx.user, 'USER_SESSIONS_REVOKE', { targetUserId: target.uid, targetUsername: target.username });
  return { revoked: true };
}

/* ───────────── 영구 삭제 ───────────── */

function apiUsersDelete_(ctx, p) {
  requireSuperAdmin_(ctx);
  const target = loadManageableUser_(ctx, p.uid);
  if (target.uid === ctx.user.uid) fail_('FORBIDDEN', '자신의 계정은 삭제할 수 없습니다.');
  if (target.role === ROLES.SUPER_ADMIN && activeSuperAdminCount_() <= 1) fail_('LAST_SUPER_ADMIN', '마지막 최고관리자 계정은 삭제할 수 없습니다.');
  if (normalizeUsername_(p.confirmUsername) !== target.normalizedUsername) fail_('CONFIRM_MISMATCH', '확인용 아이디가 일치하지 않습니다.');
  requireReauth_(ctx, p.reauthPassword);
  platform_().auth.deleteAccount(target.uid);
  platform_().store.commit([
    { type: 'delete', col: COL.USERS, id: target.uid },
    { type: 'delete', col: COL.USERNAME_MAPPINGS, id: target.normalizedUsername },
    { type: 'delete', col: COL.PREFS, id: target.uid },
  ]);
  invalidateUser_(target.uid);
  logAdmin_(ctx.user, 'USER_DELETE', { targetUserId: target.uid, targetUsername: target.username, changeSummary: '영구 삭제 (접속·감사 로그는 보존 기간 동안 유지)' });
  bumpRevision_();
  return { deleted: true };
}

/* ───────────── 일괄 관리 ───────────── */

function apiUsersBulk_(ctx, p) {
  requireAdmin_(ctx);
  const uids = cleanList_(p.uids, 500, 128);
  const action = p.action;
  const serviceIds = cleanList_(p.serviceIds, 200, 64);
  if (!uids.length) fail_('INVALID_INPUT', '대상 사용자를 선택하세요.');
  const results = [];
  uids.forEach(function (uid) {
    try {
      const target = getUser_(uid);
      if (!target) fail_('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
      let patch;
      switch (action) {
        case 'activate': patch = { status: ACCOUNT_STATUS.ACTIVE }; break;
        case 'deactivate': patch = { status: ACCOUNT_STATUS.INACTIVE }; break;
        case 'grant': patch = { allowedServices: (target.allowedServices || []).concat(serviceIds.filter(function (s) { return (target.allowedServices || []).indexOf(s) < 0; })) }; break;
        case 'revoke': patch = { allowedServices: (target.allowedServices || []).filter(function (s) { return serviceIds.indexOf(s) < 0; }) }; break;
        case 'setServices': patch = { allowedServices: serviceIds }; break;
        case 'setValidity': patch = {}; if (p.validFrom !== undefined) patch.validFrom = p.validFrom; if (p.validUntil !== undefined) patch.validUntil = p.validUntil; break;
        default: fail_('INVALID_INPUT', '지원하지 않는 일괄 작업입니다.');
      }
      apiUsersUpdate_(ctx, { uid: uid, patch: patch });
      results.push({ uid: uid, username: target.username, ok: true });
    } catch (e) {
      results.push({ uid: uid, ok: false, error: e.code || 'ERROR', message: e.message });
    }
  });
  return { results: results, success: results.filter(function (r) { return r.ok; }).length, failed: results.filter(function (r) { return !r.ok; }).length };
}
