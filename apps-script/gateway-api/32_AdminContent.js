/**
 * PROFCYS Gateway API — 카테고리·공지사항·시스템 설정·UI 설정 (17·19·25장)
 * 파일: apps-script/gateway-api/32_AdminContent.js
 *
 * 저장 위치 구분: settings/platform = 전체 플랫폼 설정, settings/ui = 사용자 대시보드 화면 구성, settings/system = 내부 메타데이터
 */

/* ───────────── 카테고리 ───────────── */

function apiCategoriesList_(ctx) {
  requireAdmin_(ctx);
  const catalog = loadCatalog_();
  return {
    categories: catalog.categories.map(function (c) {
      return Object.assign({}, c, { serviceCount: catalog.services.filter(function (s) { return s.categoryId === c.categoryId; }).length });
    }).sort(function (a, b) { return a.sortOrder - b.sortOrder; }),
  };
}

function apiCategoriesSave_(ctx, p) {
  requireSuperAdmin_(ctx);
  const catalog = loadCatalog_();
  const t = now_();
  const name = cleanText_(p.categoryName, 40);
  if (!name) fail_('INVALID_INPUT', '카테고리 명칭을 입력하세요.');
  const existing = p.categoryId ? catalog.categories.filter(function (c) { return c.categoryId === p.categoryId; })[0] : null;
  if (p.categoryId && !existing) fail_('NOT_FOUND', '카테고리를 찾을 수 없습니다.');
  if (!existing && catalog.categories.some(function (c) { return c.categoryName === name; })) fail_('DUPLICATE', '같은 이름의 카테고리가 있습니다.');
  const data = {
    categoryName: name,
    description: cleanText_(p.description, 200),
    icon: cleanIcon_(p.icon, 'folder'),
    color: cleanColor_(p.color, '#2563EB'),
    sortOrder: p.sortOrder !== undefined ? Math.max(0, Math.round(Number(p.sortOrder) || 0)) : (existing ? existing.sortOrder : catalog.categories.reduce(function (m, c) { return Math.max(m, c.sortOrder || 0); }, 0) + 10),
    isActive: p.isActive !== false,
    updatedAt: t,
  };
  if (existing && existing.categoryId === 'etc') data.isActive = true; // 기본 분류는 항상 활성
  let id;
  if (existing) {
    id = existing.categoryId;
    platform_().store.update(COL.CATEGORIES, id, data);
  } else {
    id = slugify_(p.newCategoryId) || ('cat-' + randomHex_(3));
    if (catalog.categories.some(function (c) { return c.categoryId === id; }) || id === 'all') id = 'cat-' + randomHex_(3);
    platform_().store.create(COL.CATEGORIES, id, Object.assign(data, { categoryId: id, createdAt: t }));
  }
  logAdmin_(ctx.user, existing ? 'CATEGORY_UPDATE' : 'CATEGORY_CREATE', { changeSummary: id + ': ' + name });
  bumpRevision_();
  return { categoryId: id };
}

function apiCategoriesDelete_(ctx, p) {
  requireSuperAdmin_(ctx);
  const id = cleanText_(p.categoryId, 64);
  if (id === 'etc') fail_('INVALID_STATE', '기본 분류(기타)는 삭제할 수 없습니다.');
  const catalog = loadCatalog_();
  if (!catalog.categories.some(function (c) { return c.categoryId === id; })) fail_('NOT_FOUND', '카테고리를 찾을 수 없습니다.');
  const t = now_();
  const ops = [{ type: 'delete', col: COL.CATEGORIES, id: id }];
  catalog.services.filter(function (s) { return s.categoryId === id; }).forEach(function (s) {
    ops.push({ type: 'update', col: COL.SERVICES, id: s.serviceId, data: { categoryId: 'etc', updatedAt: t, version: (s.version || 0) + 1 } });
  });
  platform_().store.commit(ops);
  logAdmin_(ctx.user, 'CATEGORY_DELETE', { changeSummary: id + ' 삭제, 소속 서비스 ' + (ops.length - 1) + '개를 기타로 이동' });
  bumpRevision_();
  return { deleted: true, movedServices: ops.length - 1 };
}

function apiCategoriesReorder_(ctx, p) {
  requireSuperAdmin_(ctx);
  const items = Array.isArray(p.items) ? p.items : [];
  const catalog = loadCatalog_();
  const ops = items.filter(function (it) { return catalog.categories.some(function (c) { return c.categoryId === it.categoryId; }); })
    .map(function (it) { return { type: 'update', col: COL.CATEGORIES, id: it.categoryId, data: { sortOrder: Math.max(0, Math.round(Number(it.sortOrder) || 0)), updatedAt: now_() } }; });
  platform_().store.commit(ops);
  logAdmin_(ctx.user, 'CATEGORY_REORDER', { changeSummary: ops.length + '개 카테고리 순서 변경' });
  bumpRevision_();
  return { updated: ops.length };
}

/* ───────────── 공지사항 (25장) ───────────── */

const ANNOUNCEMENT_CATEGORIES = ['GENERAL', 'IMPORTANT', 'UPDATE', 'MAINTENANCE', 'GUIDE', 'SECURITY'];

function apiAnnouncementsList_(ctx) {
  requireAdmin_(ctx);
  return { items: loadCatalog_().announcements.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }) };
}

function apiAnnouncementsSave_(ctx, p) {
  requireAdmin_(ctx);
  const title = cleanText_(p.title, 100);
  const content = cleanText_(p.content, 5000);
  if (!title || !content) fail_('INVALID_INPUT', '제목과 내용을 입력하세요.');
  if (!isValidDateStr_(p.startDate) || !isValidDateStr_(p.endDate)) fail_('INVALID_INPUT', '게시 기간 형식(YYYY-MM-DD)이 올바르지 않습니다.');
  if (p.startDate && p.endDate && p.endDate < p.startDate) fail_('INVALID_INPUT', '게시 종료일은 시작일 이후여야 합니다.');
  const t = now_();
  const data = {
    title: title,
    content: content,
    category: ANNOUNCEMENT_CATEGORIES.indexOf(p.category) >= 0 ? p.category : 'GENERAL',
    priority: p.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
    targetRoles: cleanList_(p.targetRoles, 3, 20).filter(function (r) { return ROLE_LIST.indexOf(r) >= 0; }),
    targetServices: cleanList_(p.targetServices, 200, 64),
    isActive: p.isActive !== false,
    startDate: p.startDate || '',
    endDate: p.endDate || '',
    updatedAt: t,
    updatedBy: ctx.user.uid,
  };
  let id = cleanText_(p.announcementId, 100);
  if (id) {
    if (!platform_().store.get(COL.ANNOUNCEMENTS, id)) fail_('NOT_FOUND', '공지사항을 찾을 수 없습니다.');
    platform_().store.update(COL.ANNOUNCEMENTS, id, data);
  } else {
    id = platform_().store.add(COL.ANNOUNCEMENTS, Object.assign(data, { createdAt: t, createdBy: ctx.user.uid, createdByName: ctx.user.displayName }));
  }
  logAdmin_(ctx.user, p.announcementId ? 'ANNOUNCEMENT_UPDATE' : 'ANNOUNCEMENT_CREATE', { changeSummary: title });
  bumpRevision_();
  return { announcementId: id };
}

function apiAnnouncementsDelete_(ctx, p) {
  requireAdmin_(ctx);
  const id = cleanText_(p.announcementId, 100);
  platform_().store.remove(COL.ANNOUNCEMENTS, id);
  logAdmin_(ctx.user, 'ANNOUNCEMENT_DELETE', { changeSummary: id });
  bumpRevision_();
  return { deleted: true };
}

/* ───────────── 시스템 설정 ───────────── */

const HOSTNAME_PATTERN_ = /^(\*|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})$/;

function apiSettingsGet_(ctx) {
  requireAdmin_(ctx);
  const c = loadCatalog_();
  return { settings: c.settings, ui: c.ui, system: { bootstrappedAt: c.system.bootstrappedAt || null, deletedServiceIds: c.system.deletedServiceIds || [] } };
}

function apiSettingsSave_(ctx, p) {
  requireSuperAdmin_(ctx);
  const current = loadCatalog_().settings;
  if (p.baseVersion !== undefined && Number(p.baseVersion) !== Number(current.version || 0)) fail_('CONFLICT', '다른 관리자가 먼저 설정을 변경했습니다. 새로고침 후 다시 시도하세요.');
  const s = p.settings || {};
  const num = function (k, min, max) { if (s[k] !== undefined) out[k] = Math.min(max, Math.max(min, Math.round(Number(s[k]) || min))); };
  const out = {};
  ['platformName', 'platformNameEn', 'supportContact', 'maintenanceMessage', 'copyright'].forEach(function (k) { if (s[k] !== undefined) out[k] = cleanText_(s[k], k === 'maintenanceMessage' || k === 'supportContact' ? 300 : 100); });
  num('sessionTimeout', 5, 480);
  num('sessionWarningMinutes', 1, 30);
  num('maximumSessionDuration', 1, 24);
  num('logRetentionDays', 30, 3650);
  num('passwordMinLength', 12, 64);
  num('loginMaxAttempts', 3, 20);
  num('loginLockMinutes', 1, 1440);
  num('ssoCodeTtlSeconds', 15, 120);
  num('newBadgeDays', 1, 365);
  ['maintenanceMode', 'showRestrictedServices'].forEach(function (k) { if (s[k] !== undefined) out[k] = !!s[k]; });
  if (s.allowedServiceDomains !== undefined) {
    const list = cleanList_(s.allowedServiceDomains, 200, 100).map(function (d) { return d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); });
    const bad = list.filter(function (d) { return !HOSTNAME_PATTERN_.test(d); });
    if (bad.length) fail_('INVALID_INPUT', '허용 도메인 형식이 올바르지 않습니다: ' + bad.join(', '));
    out.allowedServiceDomains = list;
  }
  if (s.portalUrl !== undefined) {
    const u = cleanText_(s.portalUrl, 200);
    if (u && !/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(u)) fail_('INVALID_INPUT', '대표 URL 은 https:// 주소여야 합니다.');
    out.portalUrl = u.replace(/\/+$/, '');
  }
  out.registrationEnabled = false; // 자체 회원가입은 허용하지 않음 (명세 고정)
  const securityKeys = ['sessionTimeout', 'maximumSessionDuration', 'passwordMinLength', 'loginMaxAttempts', 'loginLockMinutes', 'allowedServiceDomains', 'ssoCodeTtlSeconds'];
  const changed = changedKeys_(current, Object.assign({}, current, out));
  if (changed.some(function (k) { return securityKeys.indexOf(k) >= 0; })) requireReauth_(ctx, p.reauthPassword);
  out.version = (current.version || 0) + 1;
  out.updatedAt = now_();
  out.updatedBy = ctx.user.uid;
  platform_().store.upsert(COL.SETTINGS, 'platform', out);
  logAdmin_(ctx.user, 'SETTINGS_CHANGE', { changeSummary: '변경 항목: ' + (changed.join(', ') || '없음') });
  bumpRevision_();
  return { settings: Object.assign({}, current, out), changed: changed };
}

/* ───────────── 대시보드 화면 구성 (19장) ───────────── */

const UI_LAYOUT_MODES = ['auto', 'grid2', 'grid3', 'grid4', 'list', 'compact', 'grouped'];
const UI_CARD_SIZES = ['large', 'default', 'small', 'compact'];
const UI_BOOL_KEYS = ['showWelcomeMessage', 'showServiceCount', 'showAvailableCount', 'showCategories', 'showSearch', 'showFavorites', 'showRecentServices',
  'showNewServices', 'showAnnouncements', 'showServiceDescription', 'showServiceStatus', 'showLastAccess', 'showLaunchButton'];

function sanitizeUi_(u) {
  const d = defaultUiSettings_();
  const out = {
    layoutMode: UI_LAYOUT_MODES.indexOf(u.layoutMode) >= 0 ? u.layoutMode : d.layoutMode,
    desktopColumns: Math.min(6, Math.max(0, Math.round(Number(u.desktopColumns) || 0))),
    tabletColumns: Math.min(4, Math.max(0, Math.round(Number(u.tabletColumns) || 0))),
    mobileColumns: Math.min(2, Math.max(1, Math.round(Number(u.mobileColumns) || 1))),
    cardSize: UI_CARD_SIZES.indexOf(u.cardSize) >= 0 ? u.cardSize : d.cardSize,
    defaultCardStyle: CARD_STYLES.indexOf(u.defaultCardStyle) >= 0 ? u.defaultCardStyle : d.defaultCardStyle,
    defaultSortOrder: ['manual', 'name', 'recent'].indexOf(u.defaultSortOrder) >= 0 ? u.defaultSortOrder : 'manual',
    pageSize: Math.min(100, Math.max(6, Math.round(Number(u.pageSize) || d.pageSize))),
  };
  UI_BOOL_KEYS.forEach(function (k) { out[k] = u[k] === undefined ? d[k] : !!u[k]; });
  return out;
}

function apiUiSave_(ctx, p) {
  requireSuperAdmin_(ctx);
  const current = loadCatalog_().ui;
  if (p.baseVersion !== undefined && Number(p.baseVersion) !== Number(current.version || 0)) fail_('CONFLICT', '다른 관리자가 먼저 화면 구성을 변경했습니다. 새로고침 후 다시 시도하세요.');
  const next = p.reset ? defaultUiSettings_() : sanitizeUi_(Object.assign({}, current, p.ui || {}));
  next.version = (current.version || 0) + 1;
  next.updatedAt = now_();
  next.updatedBy = ctx.user.uid;
  platform_().store.set(COL.SETTINGS, 'ui', next);
  const changed = changedKeys_(current, next);
  // 30장: 대시보드 레이아웃 변경도 변경 이력에 기록 (serviceId '__ui__')
  logServiceChange_(ctx.user, '__ui__', p.reset ? 'UI_RESET' : 'UI_CHANGE', current, next, p.reset ? '기본 디자인 복원' : '변경 항목: ' + changed.join(', '));
  bumpRevision_();
  return { ui: next, changed: changed };
}

function apiUiHistory_(ctx) {
  return apiServicesHistory_(ctx, { serviceId: '__ui__', limit: 30 });
}

function apiUiRestore_(ctx, p) {
  requireSuperAdmin_(ctx);
  const log = platform_().store.get(COL.SERVICE_CHANGE_LOGS, cleanText_(p.logId, 100));
  if (!log || log.serviceId !== '__ui__' || !log.previousSettings) fail_('NOT_FOUND', '복원할 화면 구성 이력을 찾을 수 없습니다.');
  return apiUiSave_(ctx, { ui: sanitizeUi_(log.previousSettings) });
}
