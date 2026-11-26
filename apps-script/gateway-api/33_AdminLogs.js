/**
 * PROFCYS Gateway API — 관리자 홈·접속 기록·운영 통계·백업 (11·26·30장)
 * 파일: apps-script/gateway-api/33_AdminLogs.js
 *
 * 모든 수치는 실제 Firestore 데이터에서 계산한다. 샘플·가상 통계를 만들지 않는다.
 */

function getDailyStats_(fromKey, toKey) {
  return platform_().store.list(COL.STATS_DAILY, { where: [['date', '>=', fromKey], ['date', '<=', toKey]], orderBy: [['date', 'asc']] }).map(stripMeta_);
}

function apiAdminOverview_(ctx) {
  requireAdmin_(ctx);
  const t = ctx.now;
  const catalog = loadCatalog_();
  let users = listAllUsers_();
  if (ctx.user.role === ROLES.ADMIN) users = users.filter(function (u) { return u.role === ROLES.USER; });
  const today = platform_().store.get(COL.STATS_DAILY, kstDateKey_(t)) || {};
  const active = users.filter(function (u) { return !accountProblem_(u, t); }).length;
  const byDesc = function (k) { return function (a, b) { return (b[k] || 0) - (a[k] || 0); }; };
  let services = catalog.services;
  if (ctx.user.role === ROLES.ADMIN) services = services.filter(function (s) { return (ctx.user.delegatedServices || []).indexOf(s.serviceId) >= 0; });
  const eff = services.map(function (s) { return { s: s, e: effectiveServiceStatus_(s, t) }; });
  const recentAdminLogs = ctx.user.role === ROLES.SUPER_ADMIN
    ? platform_().store.list(COL.ADMIN_LOGS, { orderBy: [['timestamp', 'desc']], limit: 8 }).map(stripMeta_) : [];
  const attention = eff.filter(function (x) {
    return x.e === SERVICE_STATUS.MAINTENANCE || x.e === 'EXPIRED' || (x.s.isInitialService && x.s.status === SERVICE_STATUS.DRAFT) ||
      ((x.e === SERVICE_STATUS.ACTIVE) && !x.s.securityVerified);
  }).map(function (x) {
    return { serviceId: x.s.serviceId, serviceName: x.s.serviceName, effectiveStatus: x.e, securityVerified: !!x.s.securityVerified, integrationStatus: x.s.integrationStatus, isInitialService: !!x.s.isInitialService };
  });
  return {
    metrics: {
      totalUsers: users.length,
      activeUsers: active,
      inactiveUsers: users.length - active,
      todayLoginUsers: Object.keys(today.loginUsers || {}).length,
      todayLogins: today.loginSuccess || 0,
      todayLoginFailures: today.loginFailure || 0,
      totalServices: services.filter(function (s) { return s.status !== SERVICE_STATUS.ARCHIVED; }).length,
      activeServices: eff.filter(function (x) { return x.e === SERVICE_STATUS.ACTIVE; }).length,
      todayServiceLaunches: today.serviceLaunchTotal || 0,
      todayAccessDenied: today.accessDenied || 0,
    },
    recentUsers: users.slice().sort(byDesc('createdAt')).slice(0, 5).map(publicUser_),
    recentLogins: users.filter(function (u) { return u.lastLoginAt; }).sort(byDesc('lastLoginAt')).slice(0, 5).map(publicUser_),
    recentAdminLogs: recentAdminLogs,
    attention: attention,
    serverTime: t,
  };
}

/* ───────────── 접속 기록 ───────────── */

function apiLogsAccess_(ctx, p) {
  requireAdmin_(ctx);
  p = p || {};
  const where = [];
  if (p.userId) where.push(['userId', '==', cleanText_(p.userId, 128)]);
  else if (p.serviceId) where.push(['serviceId', '==', cleanText_(p.serviceId, 64)]);
  else if (p.action) where.push(['action', '==', cleanText_(p.action, 40)]);
  const fromMs = kstDayStartMs_(p.from);
  const toMs = kstDayEndMs_(p.to);
  if (fromMs != null) where.push(['timestamp', '>=', fromMs]);
  if (toMs != null) where.push(['timestamp', '<=', toMs]);
  if (p.before) where.push(['timestamp', '<', Number(p.before)]);
  const limit = Math.min(500, Math.max(10, Number(p.limit) || 50));
  let items = platform_().store.list(COL.ACCESS_LOGS, { where: where, orderBy: [['timestamp', 'desc']], limit: limit * 2 }).map(function (d) { return Object.assign(stripMeta_(d), { logId: d._id }); });
  // 보조 조건 (단일 equality 인덱스만 사용하고 나머지는 메모리 필터)
  if (p.serviceId && p.userId) items = items.filter(function (x) { return x.serviceId === p.serviceId; });
  if (p.action && (p.userId || p.serviceId)) items = items.filter(function (x) { return x.action === p.action; });
  if (p.result) items = items.filter(function (x) { return x.result === p.result; });
  if (ctx.user.role === ROLES.ADMIN) {
    const allowed = {};
    listAllUsers_().forEach(function (u) { if (u.role === ROLES.USER || u.uid === ctx.user.uid) allowed[u.uid] = 1; });
    items = items.filter(function (x) { return allowed[x.userId]; });
  }
  items = items.slice(0, limit);
  items.forEach(function (x) { delete x.ttlAt; });
  return { items: items, nextBefore: items.length === limit ? items[items.length - 1].timestamp : null };
}

function apiLogsAdmin_(ctx, p) {
  requireSuperAdmin_(ctx);
  p = p || {};
  const where = [];
  if (p.adminId) where.push(['adminId', '==', cleanText_(p.adminId, 128)]);
  else if (p.action) where.push(['action', '==', cleanText_(p.action, 40)]);
  if (p.before) where.push(['timestamp', '<', Number(p.before)]);
  const fromMs = kstDayStartMs_(p.from);
  const toMs = kstDayEndMs_(p.to);
  if (fromMs != null) where.push(['timestamp', '>=', fromMs]);
  if (toMs != null) where.push(['timestamp', '<=', toMs]);
  const limit = Math.min(500, Math.max(10, Number(p.limit) || 50));
  let items = platform_().store.list(COL.ADMIN_LOGS, { where: where, orderBy: [['timestamp', 'desc']], limit: limit }).map(function (d) { return Object.assign(stripMeta_(d), { logId: d._id }); });
  if (p.action && p.adminId) items = items.filter(function (x) { return x.action === p.action; });
  items.forEach(function (x) { delete x.ttlAt; });
  return { items: items, nextBefore: items.length === limit ? items[items.length - 1].timestamp : null };
}

/* ───────────── 운영 통계 ───────────── */

function isoWeekKey_(dateKey) {
  const d = new Date(dateKey + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-W' + ('0' + week).slice(-2);
}

function apiStats_(ctx, p) {
  requireAdmin_(ctx);
  p = p || {};
  const t = ctx.now;
  const toKey = isValidDateStr_(p.to) && p.to ? p.to : kstDateKey_(t);
  const fromKey = isValidDateStr_(p.from) && p.from ? p.from : kstDateKey_(t - 29 * 86400000);
  if (kstDayStartMs_(toKey) - kstDayStartMs_(fromKey) > 400 * 86400000) fail_('INVALID_INPUT', '조회 기간은 최대 400일입니다.');
  const days = getDailyStats_(fromKey, toKey);
  const byKey = {};
  days.forEach(function (d) { byKey[d.date] = d; });
  const daily = [];
  const weekly = {};
  const monthly = {};
  const services = {};
  const totals = { loginSuccess: 0, loginFailure: 0, accessDenied: 0, serviceLaunchTotal: 0, passwordChange: 0 };
  for (let ms = kstDayStartMs_(fromKey); ms <= kstDayStartMs_(toKey); ms += 86400000) {
    const key = kstDateKey_(ms);
    const d = byKey[key] || {};
    const loginUsers = Object.keys(d.loginUsers || {});
    daily.push({ date: key, loginUsers: loginUsers.length, logins: d.loginSuccess || 0, failures: d.loginFailure || 0, denied: d.accessDenied || 0, launches: d.serviceLaunchTotal || 0 });
    Object.keys(totals).forEach(function (k) { totals[k] += d[k] || 0; });
    const wk = isoWeekKey_(key);
    const mk = key.substring(0, 7);
    weekly[wk] = weekly[wk] || {};
    monthly[mk] = monthly[mk] || {};
    loginUsers.forEach(function (u) { weekly[wk][u] = 1; monthly[mk][u] = 1; });
    ['serviceLaunch', 'serviceAuthSuccess', 'serviceAuthFailure', 'serviceDenied'].forEach(function (k) {
      Object.keys(d[k] || {}).forEach(function (sid) {
        services[sid] = services[sid] || { serviceLaunch: 0, serviceAuthSuccess: 0, serviceAuthFailure: 0, serviceDenied: 0 };
        services[sid][k] += d[k][sid] || 0;
      });
    });
  }
  const catalog = loadCatalog_();
  const names = {};
  catalog.services.forEach(function (s) { names[s.serviceId] = s.serviceName; });
  const totalLaunch = Object.keys(services).reduce(function (m, k) { return m + services[k].serviceLaunch; }, 0);
  const perService = catalog.services.filter(function (s) { return s.status !== SERVICE_STATUS.ARCHIVED || services[s.serviceId]; }).map(function (s) {
    const v = services[s.serviceId] || { serviceLaunch: 0, serviceAuthSuccess: 0, serviceAuthFailure: 0, serviceDenied: 0 };
    return Object.assign({ serviceId: s.serviceId, serviceName: s.serviceName, primaryColor: s.primaryColor, share: totalLaunch ? v.serviceLaunch / totalLaunch : 0 }, v);
  });
  Object.keys(services).forEach(function (sid) {
    if (!names[sid]) perService.push(Object.assign({ serviceId: sid, serviceName: sid + ' (삭제됨)', primaryColor: '#94A3B8', share: totalLaunch ? services[sid].serviceLaunch / totalLaunch : 0 }, services[sid]));
  });
  perService.sort(function (a, b) { return b.serviceLaunch - a.serviceLaunch; });
  const users = listAllUsers_();
  const fromMs = kstDayStartMs_(fromKey);
  return {
    from: fromKey,
    to: toKey,
    daily: daily,
    weekly: Object.keys(weekly).sort().map(function (k) { return { week: k, loginUsers: Object.keys(weekly[k]).length }; }),
    monthly: Object.keys(monthly).sort().map(function (k) { return { month: k, loginUsers: Object.keys(monthly[k]).length }; }),
    services: perService,
    totals: totals,
    users: {
      total: users.length,
      active: users.filter(function (u) { return !accountProblem_(u, t); }).length,
      inactive: users.filter(function (u) { return !!accountProblem_(u, t); }).length,
      newInPeriod: users.filter(function (u) { return (u.createdAt || 0) >= fromMs; }).length,
    },
    recentLogins: users.filter(function (u) { return u.lastLoginAt; }).sort(function (a, b) { return b.lastLoginAt - a.lastLoginAt; }).slice(0, 10)
      .map(function (u) { return { uid: u.uid, username: u.username, displayName: u.displayName, organization: u.organization, lastLoginAt: u.lastLoginAt }; }),
  };
}

/* ───────────── 백업·복원 (30장) ───────────── */

/** 비밀번호·인증 이메일·세션·인증코드·통합 인증 키는 백업에 포함하지 않는다. */
function apiBackupExport_(ctx) {
  requireSuperAdmin_(ctx);
  const c = loadCatalog_();
  const users = listAllUsers_().map(function (u) { return Object.assign(publicUser_(u), { memo: u.memo || '' }); });
  logAdmin_(ctx.user, 'BACKUP_EXPORT', { changeSummary: '사용자 ' + users.length + '명, 서비스 ' + c.services.length + '개' });
  return {
    meta: { platform: 'profcys-gateway', schemaVersion: 3, exportedAt: now_(), exportedBy: ctx.user.username, excludes: ['passwords', 'authEmails', 'sessions', 'authCodes', 'serviceKeys'] },
    users: users,
    services: c.services,
    categories: c.categories,
    announcements: c.announcements,
    settings: c.settings,
    ui: c.ui,
  };
}

/**
 * 서비스·카테고리·공지·설정 복원. 사용자 계정과 권한은 복원하지 않는다
 * (인증 계정 복구는 별도 절차이며, 백업으로 회수된 권한이 재활성화되지 않도록 한다).
 */
function apiBackupRestore_(ctx, p) {
  requireSuperAdmin_(ctx);
  requireReauth_(ctx, p.reauthPassword);
  const data = p.data || {};
  if (!data.meta || data.meta.platform !== 'profcys-gateway') fail_('INVALID_INPUT', 'PROFCYS 백업 파일이 아닙니다.');
  const scope = p.scope || {};
  const store = platform_().store;
  const catalog = loadCatalog_();
  const deleted = deletedServiceIds_();
  const ops = [];
  const report = { services: 0, servicesSkipped: [], categories: 0, announcements: 0, settings: false, ui: false };
  const t = now_();
  if (scope.categories && Array.isArray(data.categories)) {
    data.categories.forEach(function (c) {
      if (!c.categoryId || !/^[a-z0-9-]{1,40}$/.test(c.categoryId)) return;
      ops.push({ type: 'set', col: COL.CATEGORIES, id: c.categoryId, data: Object.assign({}, pick_(c, ['categoryId', 'categoryName', 'description', 'icon', 'color', 'sortOrder', 'isActive', 'createdAt']), { updatedAt: t }) });
      report.categories++;
    });
  }
  if (scope.services && Array.isArray(data.services)) {
    data.services.forEach(function (s) {
      if (!s.serviceId || deleted.indexOf(s.serviceId) >= 0) { report.servicesSkipped.push(s.serviceId); return; }
      const v = validateServiceUrl_(s.url, { allowedDomains: catalog.settings.allowedServiceDomains });
      if (!v.ok) { report.servicesSkipped.push(s.serviceId + ' (URL 정책 위반)'); return; }
      const cur = catalog.services.filter(function (x) { return x.serviceId === s.serviceId; })[0];
      const restored = Object.assign({}, s, {
        accessPolicy: cur ? cur.accessPolicy : sanitizeAccessPolicy_({ mode: 'NONE' }),
        status: cur ? cur.status : SERVICE_STATUS.DRAFT,
        securityVerified: cur ? !!cur.securityVerified : false,
        updatedAt: t, updatedBy: ctx.user.uid, version: ((cur && cur.version) || 0) + 1,
      });
      ops.push({ type: 'set', col: COL.SERVICES, id: s.serviceId, data: restored });
      report.services++;
    });
  }
  if (scope.announcements && Array.isArray(data.announcements)) {
    data.announcements.forEach(function (a) {
      if (!a.announcementId) return;
      ops.push({ type: 'set', col: COL.ANNOUNCEMENTS, id: String(a.announcementId).substring(0, 100), data: Object.assign({}, a, { updatedAt: t }) });
      report.announcements++;
    });
  }
  store.commit(ops);
  if (scope.ui && data.ui) { apiUiSave_(ctx, { ui: data.ui }); report.ui = true; }
  if (scope.settings && data.settings) {
    const s = Object.assign({}, data.settings);
    delete s.version;
    apiSettingsSave_(ctx, { settings: s, reauthPassword: p.reauthPassword });
    report.settings = true;
  }
  logAdmin_(ctx.user, 'BACKUP_RESTORE', { changeSummary: JSON.stringify(report).substring(0, 900) });
  bumpRevision_();
  return { report: report };
}
