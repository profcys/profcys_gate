/**
 * PROFCYS Gateway API — HTTP 진입점 및 라우터
 * 파일: apps-script/gateway-api/90_Main.js
 *
 * 배포: 웹 앱 / 실행 사용자 = 나(스크립트 소유자) / 액세스 권한 = 모든 사용자
 * 요청: POST, Content-Type: text/plain (CORS 사전 요청 없음), 본문 JSON {action, token?, params?, meta?}
 * 응답: {ok:true, data} 또는 {ok:false, error:{code, message, details?, errorId?, at}}
 *
 * CSRF: 인증 토큰을 쿠키가 아닌 요청 본문으로만 전달하므로 교차 사이트 요청 위조가 성립하지 않는다.
 */

/** 인증 없이 호출 가능한 action */
const PUBLIC_ACTIONS_ = {
  publicInfo: function () { return apiPublicInfo_(); },
  login: function (p, meta) { return apiLogin_(p, meta); },
  bootstrap: function (p) { return apiBootstrap_(p); },
  recoverAdmin: function (p) { return apiRecoverAdmin_(p); },
  'sso.verify': function (p) { return apiSsoVerify_(p); },
  'sso.check': function (p) { return apiSsoCheck_(p); },
};

/** 로그인 세션이 필요한 action (권한 세부 검증은 각 핸들러에서 수행) */
const AUTH_ACTIONS_ = {
  session: apiSession_,
  logout: apiLogout_,
  sync: apiSync_,
  touch: apiTouch_,
  changePassword: apiChangePassword_,
  dashboard: apiDashboard_,
  launch: apiLaunch_,
  toggleFavorite: apiToggleFavorite_,
  updatePrefs: apiUpdatePrefs_,

  'admin.overview': apiAdminOverview_,
  'admin.users.list': apiUsersList_,
  'admin.users.get': apiUsersGet_,
  'admin.users.export': apiUsersExport_,
  'admin.users.create': apiUsersCreate_,
  'admin.users.import': apiUsersImport_,
  'admin.users.update': apiUsersUpdate_,
  'admin.users.resetPassword': apiUsersResetPassword_,
  'admin.users.unlock': apiUsersUnlock_,
  'admin.users.revokeSessions': apiUsersRevokeSessions_,
  'admin.users.delete': apiUsersDelete_,
  'admin.users.bulk': apiUsersBulk_,

  'admin.services.list': apiServicesList_,
  'admin.services.get': apiServicesGet_,
  'admin.services.create': apiServicesCreate_,
  'admin.services.update': apiServicesUpdate_,
  'admin.services.setStatus': apiServicesSetStatus_,
  'admin.services.reorder': apiServicesReorder_,
  'admin.services.bulkCategory': apiServicesBulkCategory_,
  'admin.services.setUserGrants': apiServicesSetUserGrants_,
  'admin.services.purge': apiServicesPurge_,
  'admin.services.history': apiServicesHistory_,
  'admin.services.restore': apiServicesRestore_,
  'admin.services.checkUrl': apiServicesCheckUrl_,
  'admin.services.rotateKey': apiServicesRotateKey_,

  'admin.categories.list': apiCategoriesList_,
  'admin.categories.save': apiCategoriesSave_,
  'admin.categories.delete': apiCategoriesDelete_,
  'admin.categories.reorder': apiCategoriesReorder_,

  'admin.announcements.list': apiAnnouncementsList_,
  'admin.announcements.save': apiAnnouncementsSave_,
  'admin.announcements.delete': apiAnnouncementsDelete_,

  'admin.settings.get': apiSettingsGet_,
  'admin.settings.save': apiSettingsSave_,
  'admin.ui.save': apiUiSave_,
  'admin.ui.history': apiUiHistory_,
  'admin.ui.restore': apiUiRestore_,

  'admin.logs.access': apiLogsAccess_,
  'admin.logs.admin': apiLogsAdmin_,
  'admin.stats': apiStats_,
  'admin.backup.export': apiBackupExport_,
  'admin.backup.restore': apiBackupRestore_,
};

/**
 * 플랫폼 독립 요청 처리기 (Apps Script doPost 와 Node 개발 서버가 공용으로 사용)
 * @param {string} bodyText
 * @return {Object} 응답 객체
 */
function handleRequest_(bodyText) {
  const at = now_();
  let body;
  try {
    if (!bodyText || bodyText.length > 2000000) throw new ApiError('INVALID_REQUEST', '요청 형식이 올바르지 않습니다.');
    body = JSON.parse(bodyText);
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') throw new ApiError('INVALID_REQUEST', '요청 형식이 올바르지 않습니다.');
  } catch (e) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: '요청 형식이 올바르지 않습니다.', at: at } };
  }
  const action = body.action;
  const params = body.params && typeof body.params === 'object' ? body.params : {};
  const meta = { userAgent: body.meta && body.meta.ua ? String(body.meta.ua) : '' };
  try {
    let data;
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS_, action)) {
      data = PUBLIC_ACTIONS_[action](params, meta);
    } else if (Object.prototype.hasOwnProperty.call(AUTH_ACTIONS_, action)) {
      const ctx = requireAuth_(body.token, action);
      data = AUTH_ACTIONS_[action](ctx, params, meta);
    } else {
      throw new ApiError('UNKNOWN_ACTION', '지원하지 않는 요청입니다.');
    }
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    if (e instanceof ApiError) {
      return { ok: false, error: { code: e.code, message: e.message, details: e.details || undefined, at: at } };
    }
    // 내부 오류: 사용자에게는 기술 정보를 노출하지 않고, 관리자 분석용 오류 ID 와 시각만 제공
    const errorId = 'E' + at.toString(36).toUpperCase() + '-' + randomHex_(3).toUpperCase();
    console.error('[' + errorId + '] action=' + action, e && e.stack ? e.stack : e);
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다. 문제가 계속되면 관리자에게 오류 코드를 알려 주세요.', errorId: errorId, at: at } };
  }
}

/** Apps Script 웹앱 POST 진입점 */
function doPost(e) {
  const text = e && e.postData ? e.postData.contents : '';
  const result = handleRequest_(text);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/** GET: 상태 확인용 (비밀정보 없음) */
function doGet() {
  const info = { ok: true, data: { service: PROFCYS.SHORT_NAME, apiVersion: PROFCYS.API_VERSION, time: new Date().toISOString(), usage: 'POST JSON {action, token, params}' } };
  return ContentService.createTextOutput(JSON.stringify(info)).setMimeType(ContentService.MimeType.JSON);
}
