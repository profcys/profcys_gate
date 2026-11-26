/**
 * PROFCYS Gateway API — 권한 정책 단일 평가 모듈 (10·13·15·22장)
 * 파일: apps-script/gateway-api/02_Policy.js
 *
 * 모든 접근 판단은 이 파일의 순수 함수로만 수행한다. (데이터 조회·저장 없음 → 테스트 용이)
 * 원칙: 명시적으로 허용되지 않은 경우 기본 차단. 명시적 차단·계정/서비스 상태 제한이 허용보다 우선.
 */

/**
 * 계정 사용 가능 여부 (검증 우선순위 3~4단계)
 * @return {string|null} 오류 코드 또는 null(사용 가능)
 */
function accountProblem_(user, nowMs) {
  if (!user) return 'ACCOUNT_NOT_FOUND';
  if (user.status !== ACCOUNT_STATUS.ACTIVE) return 'ACCOUNT_DISABLED';
  const from = kstDayStartMs_(user.validFrom);
  if (from != null && nowMs < from) return 'ACCOUNT_NOT_STARTED';
  const until = kstDayEndMs_(user.validUntil);
  if (until != null && nowMs > until) return 'ACCOUNT_EXPIRED';
  if (user.lockedUntil && nowMs < user.lockedUntil) return 'ACCOUNT_LOCKED';
  return null;
}

/**
 * 시간 기준 실효 상태. status 가 단일 기준이며 예약 공개/종료는 서버 시간으로 평가한다.
 * 반환: DRAFT | ACTIVE | SCHEDULED | MAINTENANCE | INACTIVE | ARCHIVED | EXPIRED
 */
function effectiveServiceStatus_(service, nowMs) {
  let st = service.status;
  if (st === SERVICE_STATUS.SCHEDULED) {
    if (service.publishAt && nowMs >= service.publishAt) st = SERVICE_STATUS.ACTIVE;
    else return SERVICE_STATUS.SCHEDULED;
  }
  if ((st === SERVICE_STATUS.ACTIVE || st === SERVICE_STATUS.MAINTENANCE) && service.expireAt && nowMs >= service.expireAt) {
    return 'EXPIRED';
  }
  return st;
}

function isAdminRole_(role) {
  return role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN;
}

/**
 * 서비스 권한 보유 여부 (검증 우선순위 7단계). 서비스 상태와 무관한 "권한"만 판단한다.
 * 권한의 기준은 서비스 고유 ID 이다.
 */
function hasServicePermission_(user, service) {
  if (!user || !service) return false;
  const id = service.serviceId;
  const policy = service.accessPolicy || {};
  if ((policy.denyUserIds || []).indexOf(user.uid) >= 0) return false; // 명시적 차단 최우선
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if ((user.allowedServices || []).indexOf(id) >= 0) return true;
  if (user.role === ROLES.ADMIN && (user.delegatedServices || []).indexOf(id) >= 0) return true;
  switch (policy.mode) {
    case 'ALL':
      return true;
    case 'ADMINS':
      return isAdminRole_(user.role);
    case 'RULES': {
      // 지정된 조건(역할·기관·그룹)을 모두 충족해야 허용 (각 조건 안에서는 하나만 일치하면 됨). 조건이 없으면 차단.
      const roles = policy.roles || [];
      const orgs = policy.organizations || [];
      const pg = policy.groups || [];
      if (!roles.length && !orgs.length && !pg.length) return false;
      if (roles.length && roles.indexOf(user.role) < 0) return false;
      if (orgs.length && (!user.organization || orgs.indexOf(user.organization) < 0)) return false;
      if (pg.length && !(user.groups || []).some(function (g) { return pg.indexOf(g) >= 0; })) return false;
      return true;
    }
    default:
      return false; // NONE 또는 미설정 → 기본 차단
  }
}

/**
 * 사용자 대시보드용 서비스 평가 (검증 우선순위 7~8단계)
 * @return {{visible:boolean, canLaunch:boolean, state:string, reason:string|null, permitted:boolean, effective:string}}
 *   state: AVAILABLE | LOCKED | MAINTENANCE | STOPPED
 */
function evaluateServiceForUser_(user, service, nowMs, settings) {
  settings = settings || {};
  const eff = effectiveServiceStatus_(service, nowMs);
  const permitted = hasServicePermission_(user, service);
  const hidden = { visible: false, canLaunch: false, state: 'HIDDEN', reason: 'SERVICE_NOT_AVAILABLE', permitted: permitted, effective: eff };
  if (eff === SERVICE_STATUS.DRAFT || eff === SERVICE_STATUS.ARCHIVED || eff === SERVICE_STATUS.SCHEDULED || eff === 'EXPIRED') {
    return hidden;
  }
  if (!permitted) {
    if (settings.showRestrictedServices && eff !== SERVICE_STATUS.INACTIVE) {
      return { visible: true, canLaunch: false, state: 'LOCKED', reason: 'SERVICE_FORBIDDEN', permitted: false, effective: eff };
    }
    return Object.assign({}, hidden, { reason: 'SERVICE_FORBIDDEN' });
  }
  if (eff === SERVICE_STATUS.INACTIVE) {
    if (service.hideWhenInactive === false) {
      return { visible: true, canLaunch: false, state: 'STOPPED', reason: 'SERVICE_INACTIVE', permitted: true, effective: eff };
    }
    return Object.assign({}, hidden, { reason: 'SERVICE_INACTIVE' });
  }
  if (eff === SERVICE_STATUS.MAINTENANCE) {
    return { visible: true, canLaunch: false, state: 'MAINTENANCE', reason: 'SERVICE_MAINTENANCE', permitted: true, effective: eff };
  }
  return { visible: true, canLaunch: true, state: 'AVAILABLE', reason: null, permitted: true, effective: eff };
}

/* ───────────── 관리자 위임 범위 (10장) ───────────── */

/** actor 가 target 사용자를 관리(수정·초기화·상태변경)할 수 있는가 */
function canManageUser_(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  if (actor.role === ROLES.ADMIN) return target.role === ROLES.USER; // 최고관리자·다른 운영관리자 변경 금지
  return false;
}

/** actor 가 해당 역할을 부여할 수 있는가 */
function canAssignRole_(actor, role) {
  if (ROLE_LIST.indexOf(role) < 0) return false;
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  if (actor.role === ROLES.ADMIN) return role === ROLES.USER;
  return false;
}

/**
 * 서비스 권한 변경 범위 검증: 운영관리자는 위임받은 서비스만 부여·회수할 수 있다.
 * @return {string[]} 위임 범위를 벗어난 serviceId 목록
 */
function servicesOutsideDelegation_(actor, beforeIds, afterIds) {
  if (actor.role === ROLES.SUPER_ADMIN) return [];
  const delegated = actor.delegatedServices || [];
  const before = beforeIds || [];
  const after = afterIds || [];
  const changed = [];
  after.forEach(function (id) { if (before.indexOf(id) < 0) changed.push(id); });
  before.forEach(function (id) { if (after.indexOf(id) < 0) changed.push(id); });
  return changed.filter(function (id) { return delegated.indexOf(id) < 0; });
}

/**
 * 서비스 관리 작업 권한
 * op: create | edit | maintenance | publish | archive | purge | policy | key
 */
function canManageService_(actor, service, op) {
  if (!actor) return false;
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  if (actor.role !== ROLES.ADMIN) return false;
  if (op !== 'edit' && op !== 'maintenance') return false;
  return !!service && (actor.delegatedServices || []).indexOf(service.serviceId) >= 0;
}

/**
 * mustChangePassword 상태에서 허용되는 action (검증 우선순위 5단계)
 */
const ACTIONS_ALLOWED_BEFORE_PASSWORD_CHANGE = ['session', 'changePassword', 'logout', 'touch', 'sync'];
