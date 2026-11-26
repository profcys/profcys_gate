/**
 * PROFCYS Gateway API — 동적 업무 서비스 관리 (14·15·16·17·30장)
 * 파일: apps-script/gateway-api/31_AdminServices.js
 *
 * 서비스는 Firestore services 컬렉션에만 존재하며, 등록·수정 즉시 사용자 대시보드·권한 화면·통계에 반영된다.
 * (게이트웨이 소스코드 수정이나 Firebase Hosting 재배포가 필요 없다.)
 */

const SERVICE_PALETTE_ = ['#4285F4', '#0F9D58', '#E37400', '#9334E6', '#D93025', '#00897B', '#1A73E8', '#5E35B1', '#F9AB00', '#455A64'];

/** 운영관리자(위임)가 수정할 수 있는 필드 */
const SERVICE_DELEGATE_FIELDS_ = ['serviceName', 'englishName', 'description', 'detailedDescription', 'keywords', 'icon', 'primaryColor',
  'backgroundColor', 'thumbnailUrl', 'cardStyle', 'maintenanceMessage', 'categoryId'];

function sanitizeAccessPolicy_(p) {
  p = p || {};
  const mode = POLICY_MODES.indexOf(p.mode) >= 0 ? p.mode : 'NONE';
  return {
    mode: mode,
    roles: cleanList_(p.roles, 3, 20).filter(function (r) { return ROLE_LIST.indexOf(r) >= 0; }),
    organizations: cleanList_(p.organizations, 100, 100),
    groups: cleanList_(p.groups, 100, 50),
    denyUserIds: cleanList_(p.denyUserIds, 1000, 128),
    applyToFutureMembers: p.applyToFutureMembers !== false,
  };
}

function optionalMs_(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  if (!isFinite(n)) fail_('INVALID_INPUT', '날짜·시간 형식이 올바르지 않습니다.');
  return n;
}

function sanitizeServiceFields_(p, existing) {
  const out = {};
  const settings = getSettings_();
  const catalog = loadCatalog_();
  const text = function (k, max, required) {
    if (p[k] === undefined) return;
    out[k] = cleanText_(p[k], max);
    if (required && !out[k]) fail_('INVALID_INPUT', '서비스 명칭을 입력하세요.');
  };
  text('serviceName', 60, true);
  text('englishName', 80);
  text('description', 200);
  text('detailedDescription', 2000);
  text('maintenanceMessage', 300);
  if (p.url !== undefined) {
    const v = validateServiceUrl_(p.url, {
      allowedDomains: settings.allowedServiceDomains,
      existing: catalog.services,
      selfId: existing && existing.serviceId,
    });
    if (!v.ok) fail_(v.errors[0].code, v.errors.map(function (e) { return e.message; }).join(' '), { errors: v.errors });
    out.url = v.url;
  }
  if (p.serviceType !== undefined) out.serviceType = SERVICE_TYPES.indexOf(p.serviceType) >= 0 ? p.serviceType : 'OTHER';
  if (p.categoryId !== undefined) {
    const ok = catalog.categories.some(function (c) { return c.categoryId === p.categoryId; });
    out.categoryId = ok ? p.categoryId : 'etc';
  }
  if (p.keywords !== undefined) out.keywords = cleanList_(p.keywords, 20, 30);
  if (p.icon !== undefined) out.icon = cleanIcon_(p.icon, 'apps');
  if (p.primaryColor !== undefined) out.primaryColor = cleanColor_(p.primaryColor, '#2563EB');
  if (p.backgroundColor !== undefined) out.backgroundColor = cleanColor_(p.backgroundColor, '#FFFFFF');
  if (p.thumbnailUrl !== undefined) {
    const t = cleanText_(p.thumbnailUrl, 1000);
    if (t && (!/^https:\/\/[^\s<>"']+$/i.test(t) || !parseUrl_(t) || isIpLiteral_(parseUrl_(t).host))) fail_('INVALID_INPUT', '썸네일 이미지는 https:// 주소만 사용할 수 있습니다.');
    out.thumbnailUrl = t;
  }
  if (p.cardStyle !== undefined) out.cardStyle = CARD_STYLES.indexOf(p.cardStyle) >= 0 ? p.cardStyle : '';
  if (p.sortOrder !== undefined) out.sortOrder = Math.max(0, Math.min(1000000, Math.round(Number(p.sortOrder) || 0)));
  ['isPinned', 'showNewBadge', 'securityVerified', 'hideWhenInactive'].forEach(function (k) { if (p[k] !== undefined) out[k] = !!p[k]; });
  ['newBadgeUntil', 'publishAt', 'expireAt'].forEach(function (k) { if (p[k] !== undefined) out[k] = optionalMs_(p[k]); });
  if (p.openMode !== undefined) out.openMode = OPEN_MODES.indexOf(p.openMode) >= 0 ? p.openMode : 'NEW_TAB';
  if (p.ssoTransport !== undefined) out.ssoTransport = SSO_TRANSPORTS.indexOf(p.ssoTransport) >= 0 ? p.ssoTransport : 'POST';
  if (p.authenticationMode !== undefined) out.authenticationMode = AUTH_MODES.indexOf(p.authenticationMode) >= 0 ? p.authenticationMode : 'UNVERIFIED';
  if (p.integrationStatus !== undefined) out.integrationStatus = INTEGRATION_STATUS.indexOf(p.integrationStatus) >= 0 ? p.integrationStatus : 'LINK_ONLY';
  if (p.directAccess !== undefined) out.directAccess = DIRECT_ACCESS_STATES.indexOf(p.directAccess) >= 0 ? p.directAccess : 'UNVERIFIED';
  if (p.accessPolicy !== undefined) out.accessPolicy = sanitizeAccessPolicy_(p.accessPolicy);
  if (p.assignedAdminIds !== undefined) out.assignedAdminIds = cleanList_(p.assignedAdminIds, 50, 128);
  const start = out.publishAt !== undefined ? out.publishAt : existing && existing.publishAt;
  const end = out.expireAt !== undefined ? out.expireAt : existing && existing.expireAt;
  if (start && end && end <= start) fail_('INVALID_INPUT', '공개 종료일은 공개 시작일 이후여야 합니다.');
  // "완전한 통합 인증 완료"는 보안 검증과 직접 접근 차단 확인이 모두 끝난 경우에만 허용 (21장)
  const integ = out.integrationStatus || (existing && existing.integrationStatus);
  const verified = out.securityVerified !== undefined ? out.securityVerified : existing && existing.securityVerified;
  const direct = out.directAccess || (existing && existing.directAccess);
  if (integ === 'FULL_SSO' && (!verified || direct !== 'BLOCKED')) {
    fail_('INVALID_INPUT', '보안 검증 완료 및 직접 URL 접근 차단 확인 후에만 "완전한 통합 인증 완료"로 표시할 수 있습니다.');
  }
  return out;
}

function loadServiceFresh_(serviceId) {
  const d = platform_().store.get(COL.SERVICES, cleanText_(serviceId, 64));
  if (!d) fail_('SERVICE_NOT_FOUND', '서비스를 찾을 수 없습니다.');
  return d;
}

function adminServiceView_(s, users, t, secrets) {
  const count = users ? users.filter(function (u) { return u.status === ACCOUNT_STATUS.ACTIVE && hasServicePermission_(u, s); }).length : null;
  return Object.assign(stripMeta_(s), {
    effectiveStatus: effectiveServiceStatus_(s, t),
    permittedUserCount: count,
    hasIntegrationKey: secrets ? !!secrets[s.serviceId] : undefined,
    lastSsoSuccessAt: secrets && secrets[s.serviceId] ? secrets[s.serviceId].lastSsoSuccessAt || null : undefined,
  });
}

function deletedServiceIds_() {
  return (loadCatalog_().system || {}).deletedServiceIds || [];
}

function generateServiceId_(p, services) {
  const taken = services.map(function (s) { return s.serviceId; }).concat(deletedServiceIds_());
  let base = slugify_(p.serviceId) || slugify_(p.englishName);
  if (base && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(base)) base = '';
  if (!base) {
    let id;
    do { id = 'svc-' + randomHex_(3); } while (taken.indexOf(id) >= 0);
    return id;
  }
  if (taken.indexOf(base) < 0) return base;
  for (let i = 2; i < 1000; i++) if (taken.indexOf(base + '-' + i) < 0) return base + '-' + i;
  return 'svc-' + randomHex_(4);
}

/* ───────────── 조회 ───────────── */

function apiServicesList_(ctx) {
  requireAdmin_(ctx);
  const catalog = loadCatalog_();
  const users = listAllUsers_();
  let services = catalog.services;
  if (ctx.user.role === ROLES.ADMIN) services = services.filter(function (s) { return (ctx.user.delegatedServices || []).indexOf(s.serviceId) >= 0; });
  const secrets = ctx.user.role === ROLES.SUPER_ADMIN ? platform_().store.getMany(COL.SERVICE_SECRETS, services.map(function (s) { return s.serviceId; })) : null;
  return {
    services: services.map(function (s) { return adminServiceView_(s, users, ctx.now, secrets); })
      .sort(function (a, b) { return (b.isPinned - a.isPinned) || (a.sortOrder - b.sortOrder); }),
    categories: catalog.categories.slice().sort(function (a, b) { return a.sortOrder - b.sortOrder; }),
    allowedServiceDomains: catalog.settings.allowedServiceDomains,
    serverTime: ctx.now,
  };
}

function apiServicesGet_(ctx, p) {
  requireAdmin_(ctx);
  const s = findService_(p.serviceId);
  if (!s || !canManageService_(ctx.user, s, 'edit')) fail_('SERVICE_NOT_FOUND', '서비스를 찾을 수 없습니다.');
  const secrets = ctx.user.role === ROLES.SUPER_ADMIN ? platform_().store.getMany(COL.SERVICE_SECRETS, [s.serviceId]) : null;
  return { service: adminServiceView_(s, listAllUsers_(), ctx.now, secrets) };
}

/* ───────────── 등록 (간편·상세) ───────────── */

function apiServicesCreate_(ctx, p) {
  requireAdmin_(ctx);
  if (!canManageService_(ctx.user, null, 'create')) fail_('FORBIDDEN', '서비스 등록은 최고관리자만 할 수 있습니다.');
  if (!cleanText_(p.serviceName, 60)) fail_('INVALID_INPUT', '서비스 명칭을 입력하세요.');
  if (!p.url) fail_('URL_REQUIRED', '서비스 연결 URL 을 입력하세요.');
  return platform_().lock.withLock(function () {
    cacheInvalidate_('catalog');
    const catalog = loadCatalog_();
    const fields = sanitizeServiceFields_(p, null);
    const type = fields.serviceType || classifyServiceType_(fields.url);
    const typeDefaults = SERVICE_TYPE_DEFAULTS[type] || SERVICE_TYPE_DEFAULTS.OTHER;
    const maxOrder = catalog.services.reduce(function (m, s) { return Math.max(m, s.sortOrder || 0); }, 0);
    const t = now_();
    const serviceId = generateServiceId_(p, catalog.services);
    const service = Object.assign({
      serviceId: serviceId,
      serviceName: '',
      englishName: '',
      description: '',
      detailedDescription: '',
      url: '',
      serviceType: type,
      categoryId: 'etc',
      keywords: [],
      icon: typeDefaults.icon,
      primaryColor: SERVICE_PALETTE_[catalog.services.length % SERVICE_PALETTE_.length],
      backgroundColor: '#FFFFFF',
      thumbnailUrl: '',
      cardStyle: '',
      sortOrder: maxOrder + 1,
      isPinned: false,
      status: SERVICE_STATUS.DRAFT, // 신규 서비스는 항상 비공개 초안으로 등록
      publishAt: null,
      expireAt: null,
      showNewBadge: true,
      newBadgeUntil: null,
      openMode: 'NEW_TAB',
      ssoTransport: 'POST',
      authenticationMode: typeDefaults.authenticationMode,
      integrationStatus: 'LINK_ONLY',
      securityVerified: false,
      directAccess: 'UNVERIFIED',
      accessPolicy: sanitizeAccessPolicy_({ mode: 'NONE' }), // 신규 서비스 권한 자동 부여 금지
      maintenanceMessage: '',
      hideWhenInactive: true,
      assignedAdminIds: [],
      publishedAt: null,
    }, fields, {
      serviceId: serviceId,
      serviceType: type,
      status: SERVICE_STATUS.DRAFT,
      createdAt: t, createdBy: ctx.user.uid, updatedAt: t, updatedBy: ctx.user.uid, version: 1,
    });
    platform_().store.create(COL.SERVICES, serviceId, service);
    logServiceChange_(ctx.user, serviceId, 'SERVICE_CREATE', null, service, (p.mode === 'quick' ? '간편 등록' : '상세 등록') + ': ' + service.serviceName);
    bumpRevision_();
    return { service: adminServiceView_(service, listAllUsers_(), t, null), next: '접근 권한을 설정하고 공개 승인하면 사용자 대시보드에 표시됩니다.' };
  });
}

/* ───────────── 수정 ───────────── */

function apiServicesUpdate_(ctx, p) {
  requireAdmin_(ctx);
  const doc = loadServiceFresh_(p.serviceId);
  if (!canManageService_(ctx.user, doc, 'edit')) fail_('FORBIDDEN', '이 서비스를 수정할 권한이 없습니다.');
  if (p.baseVersion !== undefined && Number(p.baseVersion) !== Number(doc.version || 0)) {
    fail_('CONFLICT', '다른 관리자가 먼저 수정했습니다. 최신 내용을 불러온 뒤 다시 저장하세요.', { currentVersion: doc.version });
  }
  let patch = p.patch || {};
  if (ctx.user.role !== ROLES.SUPER_ADMIN) patch = pick_(patch, SERVICE_DELEGATE_FIELDS_);
  delete patch.status; // 상태 변경은 setStatus 로만
  delete patch.serviceId;
  const fields = sanitizeServiceFields_(patch, doc);
  const before = stripMeta_(doc);
  const after = Object.assign({}, before, fields);
  const changed = changedKeys_(before, after);
  if (!changed.length) return { service: adminServiceView_(doc, listAllUsers_(), ctx.now, null), changed: [] };
  const t = now_();
  fields.updatedAt = t;
  fields.updatedBy = ctx.user.uid;
  fields.version = (doc.version || 0) + 1;
  platform_().store.update(COL.SERVICES, doc._id, fields, doc._v);
  const action = changed.indexOf('url') >= 0 ? 'SERVICE_URL_CHANGE' : changed.indexOf('accessPolicy') >= 0 ? 'SERVICE_PERMISSION_CHANGE' :
    changed.some(function (k) { return ['icon', 'primaryColor', 'backgroundColor', 'thumbnailUrl', 'cardStyle'].indexOf(k) >= 0; }) ? 'SERVICE_DESIGN_CHANGE' : 'SERVICE_UPDATE';
  logServiceChange_(ctx.user, doc._id, action, before, Object.assign(after, fields), '변경 항목: ' + changed.join(', '));
  bumpRevision_();
  return { service: adminServiceView_(Object.assign(after, fields), listAllUsers_(), t, null), changed: changed };
}

/* ───────────── 운영 상태 / 공개 승인 (15장) ───────────── */

function apiServicesSetStatus_(ctx, p) {
  requireAdmin_(ctx);
  const doc = loadServiceFresh_(p.serviceId);
  const next = p.status;
  if (SERVICE_STATUS_LIST.indexOf(next) < 0) fail_('INVALID_INPUT', '서비스 상태가 올바르지 않습니다.');
  const current = doc.status;
  const maintenanceToggle = (next === SERVICE_STATUS.MAINTENANCE && current === SERVICE_STATUS.ACTIVE) || (next === SERVICE_STATUS.ACTIVE && current === SERVICE_STATUS.MAINTENANCE);
  if (!canManageService_(ctx.user, doc, maintenanceToggle ? 'maintenance' : 'publish')) fail_('FORBIDDEN', '서비스 상태를 변경할 권한이 없습니다.');
  const t = now_();
  const patch = { status: next, updatedAt: t, updatedBy: ctx.user.uid, version: (doc.version || 0) + 1 };
  const warnings = [];
  if (next === SERVICE_STATUS.ACTIVE || next === SERVICE_STATUS.SCHEDULED) {
    if (!maintenanceToggle && !p.approve) fail_('APPROVAL_REQUIRED', '공개 승인을 확인해야 합니다.');
    const v = validateServiceUrl_(doc.url, { allowedDomains: getSettings_().allowedServiceDomains, existing: loadCatalog_().services, selfId: doc._id });
    if (!v.ok) fail_(v.errors[0].code, '현재 URL 이 검증 정책을 통과하지 못해 공개할 수 없습니다: ' + v.errors[0].message);
    if (next === SERVICE_STATUS.SCHEDULED) {
      const at = optionalMs_(p.publishAt !== undefined ? p.publishAt : doc.publishAt);
      if (!at || at <= t) fail_('INVALID_INPUT', '예약 공개 시각은 현재 이후여야 합니다.');
      patch.publishAt = at;
    }
    if (!maintenanceToggle && (current === SERVICE_STATUS.DRAFT || current === SERVICE_STATUS.SCHEDULED || !doc.publishedAt)) {
      patch.publishedAt = next === SERVICE_STATUS.SCHEDULED ? patch.publishAt : t;
    }
    const policy = doc.accessPolicy || {};
    const grantedUsers = listAllUsers_().filter(function (u) { return u.role !== ROLES.SUPER_ADMIN && hasServicePermission_(u, doc); }).length;
    if (policy.mode === 'NONE' && grantedUsers === 0) warnings.push('접근 권한이 부여된 사용자가 없어 최고관리자 외에는 표시되지 않습니다.');
    if (!doc.securityVerified) warnings.push('보안 검증이 완료되지 않은 서비스입니다. 연동 상태를 사용자에게 정확히 안내하세요.');
  }
  if (next === SERVICE_STATUS.MAINTENANCE && p.maintenanceMessage !== undefined) patch.maintenanceMessage = cleanText_(p.maintenanceMessage, 300);
  platform_().store.update(COL.SERVICES, doc._id, patch, doc._v);
  const labels = { DRAFT: '초안', ACTIVE: '공개', SCHEDULED: '예약 공개', MAINTENANCE: '점검', INACTIVE: '비활성', ARCHIVED: '보관' };
  const action = next === SERVICE_STATUS.ACTIVE && !maintenanceToggle ? 'SERVICE_PUBLISH' : next === SERVICE_STATUS.ARCHIVED ? 'SERVICE_ARCHIVE' : 'SERVICE_STATUS_CHANGE';
  logServiceChange_(ctx.user, doc._id, action, stripMeta_(doc), Object.assign(stripMeta_(doc), patch), '상태: ' + (labels[current] || current) + ' → ' + (labels[next] || next));
  bumpRevision_();
  return { service: adminServiceView_(Object.assign(stripMeta_(doc), patch), listAllUsers_(), t, null), warnings: warnings };
}

/* ───────────── 순서 (17장) ───────────── */

function apiServicesReorder_(ctx, p) {
  requireSuperAdmin_(ctx);
  const items = Array.isArray(p.items) ? p.items.slice(0, 1000) : [];
  const catalog = loadCatalog_();
  const map = {};
  catalog.services.forEach(function (s) { map[s.serviceId] = s; });
  const ops = [];
  const t = now_();
  const changedIds = [];
  items.forEach(function (it) {
    const s = map[it.serviceId];
    if (!s) return;
    const sortOrder = Math.max(0, Math.round(Number(it.sortOrder) || 0));
    const isPinned = it.isPinned === undefined ? !!s.isPinned : !!it.isPinned;
    if (sortOrder === s.sortOrder && isPinned === !!s.isPinned) return;
    ops.push({ type: 'update', col: COL.SERVICES, id: s.serviceId, data: { sortOrder: sortOrder, isPinned: isPinned, updatedAt: t, updatedBy: ctx.user.uid, version: (s.version || 0) + 1 } });
    changedIds.push(s.serviceId);
  });
  if (!ops.length) return { updated: 0 };
  platform_().store.commit(ops); // 원자적 일괄 저장
  logAdmin_(ctx.user, 'SERVICE_REORDER', { changeSummary: '서비스 ' + ops.length + '개 순서·고정 변경: ' + changedIds.slice(0, 20).join(', ') });
  ops.forEach(function (op) {
    try {
      platform_().store.add(COL.SERVICE_CHANGE_LOGS, {
        serviceId: op.id, adminId: ctx.user.uid, adminUsername: ctx.user.username, action: 'SERVICE_REORDER',
        previousSettings: { sortOrder: map[op.id].sortOrder, isPinned: !!map[op.id].isPinned },
        updatedSettings: { sortOrder: op.data.sortOrder, isPinned: op.data.isPinned }, changeSummary: '순서 변경', timestamp: t,
      });
    } catch (e) { console.warn(e); }
  });
  bumpRevision_();
  return { updated: ops.length };
}

function apiServicesBulkCategory_(ctx, p) {
  requireSuperAdmin_(ctx);
  const ids = cleanList_(p.serviceIds, 500, 64);
  const catalog = loadCatalog_();
  if (!catalog.categories.some(function (c) { return c.categoryId === p.categoryId; })) fail_('INVALID_INPUT', '카테고리를 찾을 수 없습니다.');
  const t = now_();
  const ops = catalog.services.filter(function (s) { return ids.indexOf(s.serviceId) >= 0 && s.categoryId !== p.categoryId; }).map(function (s) {
    return { type: 'update', col: COL.SERVICES, id: s.serviceId, data: { categoryId: p.categoryId, updatedAt: t, updatedBy: ctx.user.uid, version: (s.version || 0) + 1 } };
  });
  platform_().store.commit(ops);
  logAdmin_(ctx.user, 'SERVICE_BULK_CATEGORY', { changeSummary: ops.length + '개 서비스 → ' + p.categoryId });
  bumpRevision_();
  return { updated: ops.length };
}

/* ───────────── 개별 사용자 권한 지정 (13장) ───────────── */

function apiServicesSetUserGrants_(ctx, p) {
  requireAdmin_(ctx);
  const s = findService_(p.serviceId);
  if (!s) fail_('SERVICE_NOT_FOUND', '서비스를 찾을 수 없습니다.');
  const grant = cleanList_(p.grantUids, 1000, 128);
  const revoke = cleanList_(p.revokeUids, 1000, 128);
  const r1 = grant.length ? apiUsersBulk_(ctx, { uids: grant, action: 'grant', serviceIds: [s.serviceId] }) : { results: [] };
  const r2 = revoke.length ? apiUsersBulk_(ctx, { uids: revoke, action: 'revoke', serviceIds: [s.serviceId] }) : { results: [] };
  return { results: r1.results.concat(r2.results) };
}

/* ───────────── 영구 삭제 (보관 후에만) ───────────── */

function apiServicesPurge_(ctx, p) {
  requireSuperAdmin_(ctx);
  const doc = loadServiceFresh_(p.serviceId);
  if (doc.status !== SERVICE_STATUS.ARCHIVED) fail_('INVALID_STATE', '보관(ARCHIVED) 상태의 서비스만 영구 삭제할 수 있습니다.');
  if (cleanText_(p.confirmServiceId, 64) !== doc._id) fail_('CONFIRM_MISMATCH', '확인용 서비스 ID 가 일치하지 않습니다.');
  requireReauth_(ctx, p.reauthPassword);
  const store = platform_().store;
  const ops = [{ type: 'delete', col: COL.SERVICES, id: doc._id }, { type: 'delete', col: COL.SERVICE_SECRETS, id: doc._id }];
  // 동일 ID 가 재사용될 때 과거 권한이 자동 부활하지 않도록 사용자 권한에서 제거하고 ID 를 영구 예약한다.
  listAllUsers_().forEach(function (u) {
    const a = (u.allowedServices || []).indexOf(doc._id) >= 0;
    const d = (u.delegatedServices || []).indexOf(doc._id) >= 0;
    if (a || d) {
      ops.push({ type: 'update', col: COL.USERS, id: u.uid, data: {
        allowedServices: (u.allowedServices || []).filter(function (x) { return x !== doc._id; }),
        delegatedServices: (u.delegatedServices || []).filter(function (x) { return x !== doc._id; }),
      } });
    }
  });
  const system = loadCatalog_().system || {};
  ops.push({ type: 'upsert', col: COL.SETTINGS, id: 'system', data: { deletedServiceIds: (system.deletedServiceIds || []).concat([doc._id]) } });
  store.commit(ops);
  listAllUsers_().forEach(function (u) { cacheInvalidate_('u:' + u.uid); });
  cacheInvalidate_('users');
  logServiceChange_(ctx.user, doc._id, 'SERVICE_DELETE', stripMeta_(doc), null, '영구 삭제 (외부 Apps Script 프로젝트와 업무 데이터는 삭제되지 않음)');
  bumpRevision_();
  return { deleted: true };
}

/* ───────────── 변경 이력 및 복원 (30장) ───────────── */

function apiServicesHistory_(ctx, p) {
  requireAdmin_(ctx);
  const id = cleanText_(p.serviceId, 64);
  if (ctx.user.role !== ROLES.SUPER_ADMIN && (ctx.user.delegatedServices || []).indexOf(id) < 0) fail_('FORBIDDEN', '권한이 없습니다.');
  const items = platform_().store.list(COL.SERVICE_CHANGE_LOGS, {
    where: [['serviceId', '==', id]], orderBy: [['timestamp', 'desc']], limit: Math.min(100, Number(p.limit) || 50),
  });
  return { items: items.map(function (d) { return Object.assign(stripMeta_(d), { logId: d._id }); }) };
}

const SERVICE_RESTORABLE_FIELDS_ = ['serviceName', 'englishName', 'description', 'detailedDescription', 'url', 'serviceType', 'categoryId', 'keywords',
  'icon', 'primaryColor', 'backgroundColor', 'thumbnailUrl', 'cardStyle', 'sortOrder', 'isPinned', 'showNewBadge', 'newBadgeUntil', 'publishAt',
  'expireAt', 'openMode', 'ssoTransport', 'maintenanceMessage', 'hideWhenInactive'];

/**
 * 이전 설정 복원. 다음은 복원하지 않는다: 접근 정책(회수된 권한의 무단 재활성화 방지), 인증·보안 검증 상태.
 * 공개 상태로 되돌리는 경우에도 자동 공개하지 않고 초안으로 복원하여 다시 공개 승인을 받게 한다.
 */
function apiServicesRestore_(ctx, p) {
  requireSuperAdmin_(ctx);
  const log = platform_().store.get(COL.SERVICE_CHANGE_LOGS, cleanText_(p.logId, 100));
  if (!log) fail_('NOT_FOUND', '변경 이력을 찾을 수 없습니다.');
  const snapshot = p.which === 'updated' ? log.updatedSettings : log.previousSettings;
  if (!snapshot) fail_('INVALID_STATE', '복원할 설정이 없습니다.');
  const existing = platform_().store.get(COL.SERVICES, log.serviceId);
  const t = now_();
  if (!existing) {
    if (deletedServiceIds_().indexOf(log.serviceId) >= 0) fail_('INVALID_STATE', '영구 삭제된 서비스 ID 는 복원할 수 없습니다. 새 서비스로 등록하세요.');
    fail_('SERVICE_NOT_FOUND', '서비스를 찾을 수 없습니다.');
  }
  const patch = sanitizeServiceFields_(pick_(snapshot, SERVICE_RESTORABLE_FIELDS_), existing); // 현재 허용 도메인 정책으로 URL 재검증
  const restoredStatus = snapshot.status;
  const wantsPublic = restoredStatus === SERVICE_STATUS.ACTIVE || restoredStatus === SERVICE_STATUS.SCHEDULED;
  const notes = [];
  if (restoredStatus && restoredStatus !== existing.status) {
    if (wantsPublic && existing.status !== SERVICE_STATUS.ACTIVE && existing.status !== SERVICE_STATUS.MAINTENANCE) {
      patch.status = SERVICE_STATUS.DRAFT;
      notes.push('공개 상태는 자동 복원하지 않고 초안으로 설정했습니다. 다시 공개 승인하세요.');
    } else if (!wantsPublic) {
      patch.status = restoredStatus;
    }
  }
  notes.push('접근 권한 정책과 인증·보안 검증 상태는 현재 값을 유지했습니다.');
  patch.updatedAt = t;
  patch.updatedBy = ctx.user.uid;
  patch.version = (existing.version || 0) + 1;
  platform_().store.update(COL.SERVICES, existing._id, patch, existing._v);
  logServiceChange_(ctx.user, existing._id, 'SERVICE_RESTORE', stripMeta_(existing), Object.assign(stripMeta_(existing), patch), '변경 이력 ' + log._id + ' 기준 복원');
  bumpRevision_();
  return { restored: true, notes: notes };
}

/* ───────────── URL 검증 / 연결 확인 (16장) ───────────── */

function apiServicesCheckUrl_(ctx, p) {
  requireAdmin_(ctx);
  const settings = getSettings_();
  const v = validateServiceUrl_(p.url, { allowedDomains: settings.allowedServiceDomains, existing: loadCatalog_().services, selfId: p.serviceId });
  const out = { validation: v, connectivity: null };
  if (!v.ok || p.skipProbe) return out;
  const r = platform_().probeUrl(v.url);
  const loc = String(r.location || '');
  const locHost = (parseUrl_(loc) || {}).host || '';
  let state;
  let note;
  if (r.status >= 200 && r.status < 300) { state = 'REACHABLE'; note = '로그인 없이 응답했습니다. 직접 URL 접근이 열려 있을 수 있습니다.'; }
  else if (r.status >= 300 && r.status < 400 && /(^|\.)accounts\.google\.com$/.test(locHost)) { state = 'GOOGLE_LOGIN_REQUIRED'; note = 'Google 계정 로그인이 필요한 서비스입니다.'; }
  else if (r.status >= 300 && r.status < 400 && /googleusercontent\.com$/.test(locHost)) { state = 'REACHABLE'; note = 'Apps Script 웹앱이 응답했습니다(공개 배포로 보임). 직접 URL 접근 차단 여부를 별도로 확인하세요.'; }
  else if (r.status >= 300 && r.status < 400) { state = 'NEEDS_REVIEW'; note = '다른 주소로 리디렉션됩니다 (' + locHost + '). 보안상 자동으로 따라가지 않았습니다.'; }
  else if (r.status === 401 || r.status === 403) { state = 'AUTH_REQUIRED'; note = '인증이 필요한 서비스입니다.'; }
  else if (r.status === 404) { state = 'NOT_FOUND'; note = '페이지를 찾을 수 없습니다 (404). URL 을 확인하세요.'; }
  else { state = 'NEEDS_REVIEW'; note = 'Google 로그인 정책 또는 교차 출처 제약으로 상태를 확인할 수 없습니다. 연결 실패로 단정하지 않습니다.'; }
  out.connectivity = { state: state, httpStatus: r.status, note: note, checkedAt: now_() };
  out.disclaimer = '연결 확인 결과는 실제 사용자 인증·이용 가능 여부나 통합 인증 완료를 의미하지 않습니다.';
  return out;
}

/* ───────────── 통합 인증 키 (21장) ───────────── */

function apiServicesRotateKey_(ctx, p) {
  requireSuperAdmin_(ctx);
  const doc = loadServiceFresh_(p.serviceId);
  requireReauth_(ctx, p.reauthPassword);
  const key = 'pk_' + randomHex_(24);
  platform_().store.set(COL.SERVICE_SECRETS, doc._id, { keyHash: sha256Hex_(key), createdAt: now_(), createdBy: ctx.user.uid });
  logAdmin_(ctx.user, 'SERVICE_KEY_ROTATE', { targetServiceId: doc._id, changeSummary: '통합 인증 키 재발급 (키 원문은 기록하지 않음)' });
  return { serviceKey: key, notice: '이 키는 지금 한 번만 표시됩니다. 해당 Apps Script 의 Script Properties(PROFCYS_SERVICE_KEY)에 저장하세요.' };
}
