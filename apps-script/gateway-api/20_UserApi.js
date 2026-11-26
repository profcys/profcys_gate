/**
 * PROFCYS Gateway API — 사용자 대시보드·서비스 실행·개인 설정 (18·20·21·25장)
 * 파일: apps-script/gateway-api/20_UserApi.js
 *
 * 보안 원칙: 사용자에게 반환하는 서비스 카드에는 연결 URL·연동 설정·접근 정책이 포함되지 않는다.
 * URL 은 서비스 실행 요청(launch) 시 권한을 다시 검증한 뒤에만 반환한다.
 */

function getPrefs_(uid) {
  return cacheThrough_('p:' + uid, 1800, function () {
    const d = platform_().store.get(COL.PREFS, uid);
    return Object.assign({ uid: uid, favoriteServices: [], recentServices: [], lastAccess: {}, theme: 'system', language: 'ko', notificationsSeenAt: 0 }, stripMeta_(d) || {});
  });
}

function savePrefs_(uid, patch) {
  patch.updatedAt = now_();
  patch.uid = uid;
  platform_().store.upsert(COL.PREFS, uid, patch);
  cacheInvalidate_('p:' + uid);
}

function isNewService_(s, nowMs, settings) {
  if (!s.showNewBadge) return false; // 관리자 수동 해제
  if (s.newBadgeUntil) return nowMs < s.newBadgeUntil; // 관리자 지정 기간
  const from = s.status === SERVICE_STATUS.SCHEDULED && s.publishAt ? s.publishAt : s.publishedAt;
  if (!from) return false;
  return nowMs - from < (Number(settings.newBadgeDays) || 14) * 86400000;
}

/** 사용자에게 공개되는 카드 정보 */
function serviceCard_(s, ev, prefs, nowMs, settings) {
  const locked = ev.state === 'LOCKED';
  const card = {
    serviceId: s.serviceId,
    serviceName: s.serviceName,
    englishName: s.englishName || '',
    icon: s.icon || 'apps',
    primaryColor: s.primaryColor || '#2563EB',
    categoryId: s.categoryId || 'etc',
    sortOrder: s.sortOrder || 0,
    isPinned: !!s.isPinned,
    state: ev.state,
    canLaunch: ev.canLaunch,
  };
  if (locked) return card; // 잠금 카드: 공개 승인된 최소 정보만 제공
  return Object.assign(card, {
    description: s.description || '',
    detailedDescription: s.detailedDescription || '',
    keywords: s.keywords || [],
    serviceType: s.serviceType || 'OTHER',
    backgroundColor: s.backgroundColor || '#FFFFFF',
    thumbnailUrl: s.thumbnailUrl || '',
    cardStyle: s.cardStyle || '',
    openMode: s.openMode || 'NEW_TAB',
    maintenanceMessage: ev.state === 'MAINTENANCE' ? (s.maintenanceMessage || '서비스 점검 중입니다.') : '',
    isNew: isNewService_(s, nowMs, settings),
    publishedAt: s.publishedAt || s.publishAt || null,
    favorite: (prefs.favoriteServices || []).indexOf(s.serviceId) >= 0,
    lastAccessAt: (prefs.lastAccess || {})[s.serviceId] || null,
  });
}

function announcementVisible_(a, user, visibleServiceIds, nowMs) {
  if (!a.isActive) return false;
  const start = kstDayStartMs_(a.startDate);
  const end = kstDayEndMs_(a.endDate);
  if (start != null && nowMs < start) return false;
  if (end != null && nowMs > end) return false;
  if ((a.targetRoles || []).length && a.targetRoles.indexOf(user.role) < 0) return false;
  if ((a.targetServices || []).length) {
    let hit = false;
    a.targetServices.forEach(function (id) { if (visibleServiceIds.indexOf(id) >= 0) hit = true; });
    if (!hit) return false;
  }
  return true;
}

function apiDashboard_(ctx) {
  const catalog = loadCatalog_();
  const user = ctx.user;
  const t = ctx.now;
  const settings = catalog.settings;
  const prefs = getPrefs_(user.uid);
  const cards = [];
  catalog.services.forEach(function (s) {
    const ev = evaluateServiceForUser_(user, s, t, settings);
    if (ev.visible) cards.push(serviceCard_(s, ev, prefs, t, settings));
  });
  cards.sort(function (a, b) {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.serviceName).localeCompare(String(b.serviceName), 'ko');
  });
  const usedCategories = {};
  cards.forEach(function (c) { usedCategories[c.categoryId] = 1; });
  const categories = catalog.categories
    .filter(function (c) { return c.isActive !== false; })
    .map(function (c) { return { categoryId: c.categoryId, categoryName: c.categoryName, icon: c.icon, color: c.color, sortOrder: c.sortOrder, serviceCount: cards.filter(function (x) { return x.categoryId === c.categoryId; }).length }; })
    .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  // 비활성 카테고리에 속한 카드는 '기타'로 표시
  const activeIds = categories.map(function (c) { return c.categoryId; });
  cards.forEach(function (c) { if (activeIds.indexOf(c.categoryId) < 0) c.categoryId = 'etc'; });

  const visibleIds = cards.filter(function (c) { return c.state !== 'LOCKED'; }).map(function (c) { return c.serviceId; });
  const announcements = catalog.announcements
    .filter(function (a) { return announcementVisible_(a, user, visibleIds, t); })
    .map(function (a) { return pick_(a, ['announcementId', 'title', 'content', 'category', 'priority', 'startDate', 'endDate', 'createdAt', 'targetServices']); })
    .sort(function (a, b) { return (b.priority === 'HIGH') - (a.priority === 'HIGH') || (b.createdAt || 0) - (a.createdAt || 0); });

  const notifications = [];
  announcements.forEach(function (a) { notifications.push({ type: 'ANNOUNCEMENT', id: a.announcementId, title: a.title, at: a.createdAt || 0, priority: a.priority }); });
  cards.forEach(function (c) { if (c.isNew && c.state === 'AVAILABLE') notifications.push({ type: 'NEW_SERVICE', id: c.serviceId, title: '신규 서비스: ' + c.serviceName, at: c.publishedAt || 0 }); });
  notifications.sort(function (a, b) { return b.at - a.at; });
  notifications.forEach(function (n) { n.unread = n.at > (prefs.notificationsSeenAt || 0); });

  const recent = (prefs.recentServices || []).filter(function (r) { return visibleIds.indexOf(r.serviceId) >= 0; }).slice(0, 8);
  return {
    user: publicUser_(user),
    services: cards,
    categories: categories.filter(function (c) { return usedCategories[c.categoryId]; }),
    ui: catalog.ui,
    announcements: announcements,
    notifications: notifications.slice(0, 30),
    prefs: { favoriteServices: (prefs.favoriteServices || []).filter(function (id) { return visibleIds.indexOf(id) >= 0; }), recentServices: recent, theme: prefs.theme, language: prefs.language },
    counts: {
      visible: cards.length,
      available: cards.filter(function (c) { return c.state === 'AVAILABLE'; }).length,
      maintenance: cards.filter(function (c) { return c.state === 'MAINTENANCE'; }).length,
      locked: cards.filter(function (c) { return c.state === 'LOCKED'; }).length,
    },
    platform: publicPlatformInfo_(settings),
    session: sessionInfo_(ctx.session, settings),
    rev: getRevision_(),
    serverTime: t,
  };
}

/**
 * 서비스 실행 (21장): 계정·권한·서비스 상태를 서버에서 재검증한 후 URL 과 (SSO 서비스인 경우) 일회용 인증 코드를 반환한다.
 */
function apiLaunch_(ctx, p) {
  const serviceId = cleanText_(p.serviceId, 64);
  const s = findService_(serviceId);
  const user = ctx.user;
  const deny = function (code, message) {
    logAccess_({ userId: user.uid, username: user.username, serviceId: serviceId, action: ACCESS_ACTIONS.ACCESS_DENIED, result: 'DENIED', errorCode: code });
    fail_(code, message);
  };
  if (!s) deny('SERVICE_NOT_FOUND', '서비스를 찾을 수 없습니다.');
  const ev = evaluateServiceForUser_(user, s, ctx.now, ctx.settings);
  if (!ev.canLaunch) {
    const messages = {
      SERVICE_FORBIDDEN: '이 서비스에 대한 접근 권한이 없습니다. 관리자에게 문의하세요.',
      SERVICE_MAINTENANCE: s.maintenanceMessage || '서비스 점검 중입니다. 잠시 후 이용하세요.',
      SERVICE_INACTIVE: '이용이 중지된 서비스입니다.',
      SERVICE_NOT_AVAILABLE: '현재 이용할 수 없는 서비스입니다.',
    };
    deny(ev.reason || 'SERVICE_NOT_AVAILABLE', messages[ev.reason] || messages.SERVICE_NOT_AVAILABLE);
  }
  const t = ctx.now;
  logAccess_({ userId: user.uid, username: user.username, serviceId: serviceId, action: ACCESS_ACTIONS.SERVICE_LAUNCH, result: 'REQUESTED' });
  try {
    const prefs = getPrefs_(user.uid);
    const recent = [{ serviceId: serviceId, at: t }].concat((prefs.recentServices || []).filter(function (r) { return r.serviceId !== serviceId; })).slice(0, 10);
    const lastAccess = Object.assign({}, prefs.lastAccess || {});
    lastAccess[serviceId] = t;
    savePrefs_(user.uid, { recentServices: recent, lastAccess: lastAccess });
  } catch (e) { console.warn('prefs update failed', e); }

  let openMode = s.openMode || 'NEW_TAB';
  if (openMode === 'EMBED' && !s.securityVerified) openMode = 'NEW_TAB'; // 보안 검증 전 임베딩 금지
  const result = { url: s.url, openMode: openMode, serviceName: s.serviceName };
  if (s.authenticationMode === 'PROFCYS_SSO' || openMode === 'SSO') {
    const code = randomHex_(32);
    const ttl = Math.min(120, Math.max(15, Number(ctx.settings.ssoCodeTtlSeconds) || 60));
    platform_().store.create(COL.AUTH_CODES, sha256Hex_(code), {
      uid: user.uid,
      serviceId: serviceId,
      sessionHash: ctx.sessionHash,
      createdAt: t,
      expiresAt: t + ttl * 1000,
      used: false,
      ttlAt: new Date(t + 86400000),
    });
    result.sso = { code: code, transport: s.ssoTransport === 'QUERY' ? 'QUERY' : 'POST', param: 'profcys_code', expiresInSec: ttl };
  }
  return result;
}

function apiToggleFavorite_(ctx, p) {
  const serviceId = cleanText_(p.serviceId, 64);
  const s = findService_(serviceId);
  if (!s || !evaluateServiceForUser_(ctx.user, s, ctx.now, ctx.settings).permitted) fail_('SERVICE_NOT_FOUND', '서비스를 찾을 수 없습니다.');
  const prefs = getPrefs_(ctx.user.uid);
  let favs = (prefs.favoriteServices || []).filter(function (id) { return id !== serviceId; });
  const on = p.favorite === undefined ? (prefs.favoriteServices || []).indexOf(serviceId) < 0 : !!p.favorite;
  if (on) favs = [serviceId].concat(favs).slice(0, 100);
  savePrefs_(ctx.user.uid, { favoriteServices: favs });
  return { favoriteServices: favs, favorite: on };
}

function apiUpdatePrefs_(ctx, p) {
  const patch = {};
  if (p.theme !== undefined) patch.theme = ['light', 'dark', 'system'].indexOf(p.theme) >= 0 ? p.theme : 'system';
  if (p.language !== undefined) patch.language = p.language === 'en' ? 'en' : 'ko';
  if (p.markNotificationsSeen) patch.notificationsSeenAt = ctx.now;
  savePrefs_(ctx.user.uid, patch);
  return { saved: true };
}

function apiSync_(ctx) {
  return { rev: getRevision_(), serverTime: ctx.now, session: sessionInfo_(ctx.session, ctx.settings) };
}

function apiTouch_(ctx) {
  return { session: sessionInfo_(ctx.session, ctx.settings), serverTime: ctx.now };
}
