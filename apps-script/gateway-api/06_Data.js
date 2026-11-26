/**
 * PROFCYS Gateway API — 데이터 접근 계층 (캐시, 리비전, 로그, 통계)
 * 파일: apps-script/gateway-api/06_Data.js
 *
 * 무료 할당량 절약 원칙 (20·28장):
 *  - 서비스/카테고리/설정/공지(카탈로그)는 한 번 읽어 스크립트 캐시에 저장하고, 관리자 변경 시에만 무효화한다.
 *  - 사용자 문서는 요청마다 캐시를 통해 조회하며, 모든 변경은 이 API 를 통해서만 이루어지므로 즉시 무효화된다.
 *  - 공개 문서 public/revision 의 rev 값을 증가시켜 열려 있는 브라우저가 필요한 영역만 다시 불러오게 한다.
 */

/* ───────────── 세대(generation) 기반 캐시: 무효화 직후 오래된 값이 다시 캐시되는 경쟁 상태 방지 ───────────── */

function cacheGet_(key) {
  const s = platform_().cache.get(key);
  if (s == null) return undefined;
  try { return JSON.parse(s); } catch (e) { return undefined; }
}

function cacheThrough_(key, ttlSec, loader) {
  const cached = cacheGet_(key);
  if (cached !== undefined) return cached;
  const cache = platform_().cache;
  const genBefore = cache.get('gen:' + key);
  const value = loader();
  const genAfter = cache.get('gen:' + key);
  if (genBefore === genAfter && value !== undefined) {
    try { cache.put(key, JSON.stringify(value), ttlSec); } catch (e) { console.warn('cache put failed', key, e); }
  }
  return value;
}

function cacheInvalidate_(key) {
  const cache = platform_().cache;
  cache.put('gen:' + key, randomHex_(4), 21600);
  cache.remove(key);
}

/* ───────────── 리비전 (변경 알림) ───────────── */

function bumpRevision_() {
  const store = platform_().store;
  try {
    store.increment(COL.PUBLIC, 'revision', { rev: 1 }, { updatedAt: now_() });
  } catch (e) {
    console.warn('bumpRevision failed', e);
  }
  cacheInvalidate_('rev');
  cacheInvalidate_('catalog');
}

function getRevision_() {
  return cacheThrough_('rev', 300, function () {
    const d = platform_().store.get(COL.PUBLIC, 'revision');
    return d ? d.rev : 0;
  });
}

/* ───────────── 카탈로그 (서비스·카테고리·설정·공지) ───────────── */

/**
 * @return {{services:Object[], categories:Object[], settings:Object, ui:Object, announcements:Object[], system:Object}}
 */
function loadCatalog_() {
  return cacheThrough_('catalog', 1800, function () {
    const store = platform_().store;
    const settingsDocs = store.getMany(COL.SETTINGS, ['platform', 'ui', 'system']);
    const services = store.list(COL.SERVICES).map(stripMeta_);
    const categories = store.list(COL.CATEGORIES).map(stripMeta_);
    const announcements = store.list(COL.ANNOUNCEMENTS).map(function (a) { return Object.assign(stripMeta_(a), { announcementId: a._id }); });
    return {
      services: services,
      categories: categories,
      settings: Object.assign(defaultPlatformSettings_(), stripMeta_(settingsDocs.platform) || {}),
      settingsVersion: settingsDocs.platform ? settingsDocs.platform._v : null,
      ui: Object.assign(defaultUiSettings_(), stripMeta_(settingsDocs.ui) || {}),
      system: stripMeta_(settingsDocs.system) || {},
      announcements: announcements,
    };
  });
}

function getSettings_() {
  return loadCatalog_().settings;
}

function findService_(serviceId) {
  const list = loadCatalog_().services;
  for (let i = 0; i < list.length; i++) if (list[i].serviceId === serviceId) return list[i];
  return null;
}

/* ───────────── 사용자 ───────────── */

function getUser_(uid) {
  if (!uid) return null;
  return cacheThrough_('u:' + uid, 300, function () {
    const d = platform_().store.get(COL.USERS, uid);
    return d ? Object.assign(stripMeta_(d), { uid: d._id }) : null;
  });
}

function invalidateUser_(uid) {
  cacheInvalidate_('u:' + uid);
  cacheInvalidate_('users');
}

/** 전체 사용자 목록 (관리자 화면용). 1,000명 규모까지 캐시 1회 조회로 처리. */
function listAllUsers_() {
  return cacheThrough_('users', 600, function () {
    return platform_().store.list(COL.USERS).map(function (d) { return Object.assign(stripMeta_(d), { uid: d._id }); });
  });
}

/** 사용자 공개 정보 (본인 또는 관리자 화면에 표시) — 내부 인증 식별자 제외 */
function publicUser_(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    username: u.username,
    displayName: u.displayName,
    organization: u.organization || '',
    department: u.department || '',
    position: u.position || '',
    email: u.email || '',
    phone: u.phone || '',
    role: u.role,
    status: u.status,
    groups: u.groups || [],
    allowedServices: u.allowedServices || [],
    delegatedServices: u.delegatedServices || [],
    mustChangePassword: !!u.mustChangePassword,
    validFrom: u.validFrom || '',
    validUntil: u.validUntil || '',
    createdAt: u.createdAt || null,
    createdBy: u.createdBy || '',
    updatedAt: u.updatedAt || null,
    lastLoginAt: u.lastLoginAt || null,
    previousLoginAt: u.previousLoginAt || null,
    passwordChangedAt: u.passwordChangedAt || null,
  };
}

/* ───────────── 로그 ───────────── */

function ttlDate_(days) {
  return new Date(now_() + Math.max(1, days || 365) * 86400000);
}

/**
 * 사용자 접속 기록 (26장). 비밀번호·토큰·인증코드 등 비밀정보는 절대 기록하지 않는다.
 */
function logAccess_(entry) {
  try {
    const settings = getSettings_();
    const t = now_();
    platform_().store.add(COL.ACCESS_LOGS, {
      userId: entry.userId || '',
      username: entry.username || '',
      serviceId: entry.serviceId || '',
      action: entry.action,
      result: entry.result || 'SUCCESS',
      errorCode: entry.errorCode || '',
      detail: cleanText_(entry.detail || '', 200),
      timestamp: t,
      ttlAt: ttlDate_(settings.logRetentionDays),
    });
    recordStat_(entry, t);
  } catch (e) {
    console.warn('logAccess failed', e);
  }
}

function recordStat_(entry, t) {
  const counters = {};
  const fields = { date: kstDateKey_(t), updatedAt: t };
  const sid = entry.serviceId;
  switch (entry.action) {
    case ACCESS_ACTIONS.LOGIN_SUCCESS:
      counters.loginSuccess = 1;
      if (entry.userId) fields['loginUsers.' + entry.userId] = true;
      break;
    case ACCESS_ACTIONS.LOGIN_FAILURE: counters.loginFailure = 1; break;
    case ACCESS_ACTIONS.ACCESS_DENIED: counters.accessDenied = 1; if (sid) counters['serviceDenied.' + sid] = 1; break;
    case ACCESS_ACTIONS.SERVICE_LAUNCH: counters.serviceLaunchTotal = 1; if (sid) counters['serviceLaunch.' + sid] = 1; if (entry.userId) fields['activeUsers.' + entry.userId] = true; break;
    case ACCESS_ACTIONS.SERVICE_AUTH_SUCCESS: if (sid) counters['serviceAuthSuccess.' + sid] = 1; break;
    case ACCESS_ACTIONS.SERVICE_AUTH_FAILURE: if (sid) counters['serviceAuthFailure.' + sid] = 1; break;
    case ACCESS_ACTIONS.PASSWORD_CHANGE: counters.passwordChange = 1; break;
    default: return;
  }
  platform_().store.increment(COL.STATS_DAILY, kstDateKey_(t), counters, fields);
}

/** 관리자 작업 기록 (26장) */
function logAdmin_(actor, action, info) {
  info = info || {};
  try {
    platform_().store.add(COL.ADMIN_LOGS, {
      adminId: actor ? actor.uid : 'system',
      adminUsername: actor ? actor.username : 'system',
      targetUserId: info.targetUserId || '',
      targetUsername: info.targetUsername || '',
      targetServiceId: info.targetServiceId || '',
      action: action,
      changeSummary: cleanText_(info.changeSummary || '', 1000),
      result: info.result || 'SUCCESS',
      timestamp: now_(),
      ttlAt: ttlDate_(Math.max(365, getSettings_().logRetentionDays)),
    });
  } catch (e) {
    console.warn('logAdmin failed', e);
  }
}

/** 서비스 변경 이력에서 제외할 필드 (비밀정보는 애초에 서비스 문서에 없지만 방어적으로 제외) */
const SERVICE_HISTORY_EXCLUDE_ = ['_id', '_v'];

function serviceSnapshot_(s) {
  if (!s) return null;
  const o = clone_(stripMeta_(s));
  SERVICE_HISTORY_EXCLUDE_.forEach(function (k) { delete o[k]; });
  return o;
}

/**
 * 서비스 변경 이력 (14·30장). 관리자 감사 로그(adminLogs)에는 요약만, 변경 전후 전체 설정은 serviceChangeLogs 에만 기록한다.
 */
function logServiceChange_(actor, serviceId, action, before, after, summary) {
  try {
    platform_().store.add(COL.SERVICE_CHANGE_LOGS, {
      serviceId: serviceId,
      adminId: actor ? actor.uid : 'system',
      adminUsername: actor ? actor.username : 'system',
      action: action,
      previousSettings: serviceSnapshot_(before),
      updatedSettings: serviceSnapshot_(after),
      changeSummary: cleanText_(summary || '', 1000),
      timestamp: now_(),
    });
  } catch (e) {
    console.warn('logServiceChange failed', e);
  }
  logAdmin_(actor, action, { targetServiceId: serviceId, changeSummary: summary });
}
