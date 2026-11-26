/**
 * PROFCYS Gateway API — 기본 설정 및 초기 등록 데이터 (7·17·19·22장)
 * 파일: apps-script/gateway-api/05_Seed.js
 *
 * 초기 4개 업무 서비스는 "초기 등록 데이터"로만 사용된다. 등록 이후의 모든 서비스 정보는 Firestore 에서 관리하며
 * 프런트엔드 소스코드에는 어떤 서비스 목록도 고정되어 있지 않다.
 */

function defaultPlatformSettings_() {
  return {
    platformName: PROFCYS.PLATFORM_NAME,
    platformNameEn: PROFCYS.PLATFORM_NAME_EN,
    platformLogo: '',
    sessionTimeout: 60, // 분: 비활성 자동 로그아웃
    sessionWarningMinutes: 5, // 만료 N분 전 안내
    maximumSessionDuration: 12, // 시간: 최대 연속 로그인
    maintenanceMode: false,
    maintenanceMessage: '',
    supportContact: 'PROFCYS 플랫폼 관리자에게 문의하세요.',
    timezone: PROFCYS.TIMEZONE,
    defaultLanguage: 'ko',
    showRestrictedServices: false, // 권한 없는 서비스: false=숨김, true=잠금 카드
    logRetentionDays: 365,
    registrationEnabled: false, // 자체 회원가입은 항상 비활성 (서버에서 강제)
    allowedServiceDomains: DEFAULT_ALLOWED_SERVICE_DOMAINS.slice(),
    passwordMinLength: 12,
    loginMaxAttempts: 5,
    loginLockMinutes: 15,
    ssoCodeTtlSeconds: 60,
    newBadgeDays: 14,
    portalUrl: '', // 최종 확정된 대표 URL (QR코드에 사용). 실제 배포 후 입력.
    copyright: '© PROFCYS. All rights reserved.',
    version: 1,
  };
}

function defaultUiSettings_() {
  return {
    layoutMode: 'auto', // auto | grid2 | grid3 | grid4 | list | compact | grouped
    desktopColumns: 0, // 0 = 자동
    tabletColumns: 0,
    mobileColumns: 1,
    cardSize: 'default', // large | default | small | compact
    defaultCardStyle: 'default', // default | icon | thumbnail | list | color
    showWelcomeMessage: true,
    showServiceCount: true,
    showAvailableCount: true,
    showCategories: true,
    showSearch: true,
    showFavorites: true,
    showRecentServices: true,
    showNewServices: true,
    showAnnouncements: true,
    showServiceDescription: true,
    showServiceStatus: true,
    showLastAccess: true,
    showLaunchButton: true,
    defaultSortOrder: 'manual', // manual | name | recent
    pageSize: 24,
    version: 1,
  };
}

function defaultCategories_() {
  const list = [
    ['common', '공통업무', 'work', '#4285F4'],
    ['startup', '창업지원', 'rocket_launch', '#E37400'],
    ['mentoring', '멘토링', 'groups', '#0F9D58'],
    ['evaluation', '심사 및 평가', 'fact_check', '#9334E6'],
    ['education', '교육 및 프로그램', 'school', '#1A73E8'],
    ['ai', 'AI 업무지원', 'smart_toy', '#00897B'],
    ['research', '연구 및 분석', 'analytics', '#5E35B1'],
    ['administration', '행정관리', 'admin_panel_settings', '#455A64'],
    ['etc', '기타', 'more_horiz', '#64748B'],
  ];
  return list.map(function (c, i) {
    return { categoryId: c[0], categoryName: c[1], description: '', icon: c[2], color: c[3], sortOrder: (i + 1) * 10, isActive: true };
  });
}

/** 7장 초기 연동 대상 업무 서비스 — URL 은 명세서 원문 그대로 사용 (임의 변경 금지) */
function initialServices_() {
  const base = {
    serviceType: 'APPS_SCRIPT',
    detailedDescription: '',
    keywords: [],
    backgroundColor: '#FFFFFF',
    thumbnailUrl: '',
    cardStyle: 'default',
    isPinned: false,
    // 보안·공개 검증 전에는 관리자 검토 상태(DRAFT)로 유지한다. 목표 상태는 ACTIVE.
    status: SERVICE_STATUS.DRAFT,
    targetStatus: SERVICE_STATUS.ACTIVE,
    publishAt: null,
    expireAt: null,
    showNewBadge: false,
    newBadgeUntil: null,
    openMode: 'NEW_TAB',
    ssoTransport: 'POST',
    authenticationMode: 'SSO_REQUIRED',
    integrationStatus: 'LINK_ONLY',
    securityVerified: false,
    directAccess: 'UNVERIFIED',
    accessPolicy: { mode: 'NONE', roles: [], organizations: [], groups: [], denyUserIds: [] },
    maintenanceMessage: '',
    hideWhenInactive: true,
    assignedAdminIds: [],
    isInitialService: true,
  };
  const s = [
    {
      serviceId: 'common-work', serviceName: '공통작업 플랫폼', englishName: 'Collaborative Workspace',
      description: '공동 업무, 협업 및 업무지원 플랫폼', icon: 'workspaces', primaryColor: '#4285F4', sortOrder: 1, categoryId: 'common',
      keywords: ['공동업무', '협업', 'workspace'],
      url: 'https://script.google.com/macros/s/AKfycbyWx-AzrUQ5uqe9DSVEefQioUIElTtTF7kyZH1x8fc42GgWXonZ7Owkk6cVXmKgM6Eg2Q/exec',
    },
    {
      serviceId: 'mentor-matching', serviceName: '멘토-멘티 일정 매칭', englishName: 'Mentor-Mentee Scheduling',
      description: '멘토와 멘티 간 일정 조율 및 매칭 관리', icon: 'calendar_month', primaryColor: '#0F9D58', sortOrder: 2, categoryId: 'mentoring',
      keywords: ['멘토', '멘티', '일정', '매칭'],
      url: 'https://script.google.com/macros/s/AKfycbxryZa0Rh2fTy8D3xq86mjbRfLkByKmdcgbLTEuw7qAgwez5uDBb9FR1boWDSJmJLdj2w/exec',
    },
    {
      serviceId: 'startup-mentoring', serviceName: '창업 멘토링 지원', englishName: 'Startup Mentoring Support',
      description: '창업기업 멘토링, 상담 및 활동 지원', icon: 'groups', primaryColor: '#E37400', sortOrder: 3, categoryId: 'startup',
      keywords: ['창업', '멘토링', '상담'],
      url: 'https://script.google.com/macros/s/AKfycbxGe1bxigLLQwcYZFn-S5k1JlVipK1v9io7bCjkEJdLImjAr7XqEhsXrYYyvnGGntpwVg/exec',
    },
    {
      serviceId: 'startup-evaluation', serviceName: '창업 심사 지원', englishName: 'Startup Evaluation Support',
      description: '창업기업 심사, 평가 및 심사 업무 지원', icon: 'fact_check', primaryColor: '#9334E6', sortOrder: 4, categoryId: 'evaluation',
      keywords: ['심사', '평가', '창업'],
      url: 'https://script.google.com/macros/s/AKfycbwt1eygC06UCPJ24L-tzfb36irrTl2NUX7nrKzBgNeR1gO20td5rDJ-a2SYEf-B8NF0/exec',
    },
  ];
  return s.map(function (x) { return Object.assign({}, base, x); });
}

/**
 * 데이터베이스 기본 설정 생성 — 반복 실행해도 기존 데이터를 덮어쓰거나 중복 생성하지 않는다 (31장).
 * @return {{created:string[], skipped:string[]}}
 */
function seedDatabase_(actorId) {
  const store = platform_().store;
  const t = now_();
  const created = [];
  const skipped = [];
  const ensure = function (col, id, data) {
    if (store.get(col, id)) { skipped.push(col + '/' + id); return; }
    try {
      store.create(col, id, data);
      created.push(col + '/' + id);
    } catch (e) {
      if (e.code === 'CONFLICT') skipped.push(col + '/' + id); else throw e;
    }
  };
  ensure(COL.SETTINGS, 'platform', Object.assign(defaultPlatformSettings_(), { updatedAt: t, updatedBy: actorId || 'system' }));
  ensure(COL.SETTINGS, 'ui', Object.assign(defaultUiSettings_(), { updatedAt: t, updatedBy: actorId || 'system' }));
  ensure(COL.PUBLIC, 'revision', { rev: 1, updatedAt: t });
  defaultCategories_().forEach(function (c) {
    ensure(COL.CATEGORIES, c.categoryId, Object.assign(c, { createdAt: t, updatedAt: t }));
  });
  initialServices_().forEach(function (s) {
    ensure(COL.SERVICES, s.serviceId, Object.assign(s, {
      createdAt: t, createdBy: actorId || 'system', updatedAt: t, updatedBy: actorId || 'system', version: 1, publishedAt: null,
    }));
  });
  if (created.length) bumpRevision_();
  return { created: created, skipped: skipped };
}
