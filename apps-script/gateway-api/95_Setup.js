/**
 * PROFCYS Gateway API — 스크립트 소유자 전용 운영 함수 (Apps Script 편집기에서 직접 실행)
 * 파일: apps-script/gateway-api/95_Setup.js
 *
 * 이 파일의 함수 이름은 밑줄(_)로 끝나지 않으므로 편집기의 [실행] 메뉴에 표시된다.
 * 웹앱 요청(doPost)으로는 호출할 수 없다. (라우터에 등록되어 있지 않음)
 *
 *  1) checkConfiguration()     — Script Properties 와 Firestore/Firebase Auth 연결 점검
 *  2) initializeDatabase()     — 기본 설정·카테고리·초기 4개 서비스 등록 (반복 실행 안전)
 *  3) enableInitialSetup()     — 최초 관리자(profcys) 생성용 일회용 설정 토큰 발급 (30분 유효)
 *  4) enableAdminRecovery()    — 관리자 계정 분실 시 복구 토큰 발급 (30분 유효)
 *  5) exportBackupToSheet()    — 사용자(비밀정보 제외)·서비스·설정을 Google Sheets 로 백업
 *  6) exportStatsToSheet()     — 일별 운영 통계를 Google Sheets 로 내보내기 (Looker Studio 연결용)
 *  7) cleanupExpiredRecords()  — Firestore TTL 정책을 쓰지 않는 경우 만료된 세션·코드·로그 정리
 *  8) installMaintenanceTriggers() — 5·6·7 번을 매일 자동 실행하는 트리거 설치
 */

function checkConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const report = [];
  if (props.getProperty('FIREBASE_PROJECT_ID') && !props.getProperty('FIREBASE_WEB_API_KEY')) {
    try {
      const key = discoverFirebaseWebApiKey_(props.getProperty('FIREBASE_PROJECT_ID'));
      props.setProperty('FIREBASE_WEB_API_KEY', key);
      report.push('ℹ FIREBASE_WEB_API_KEY 를 Firebase 웹 앱 설정에서 자동으로 가져왔습니다.');
    } catch (e) {
      report.push('✘ FIREBASE_WEB_API_KEY 자동 조회 실패: ' + e.message + ' (Firebase 콘솔에서 웹 앱을 등록했는지 확인하세요)');
    }
  }
  ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY'].forEach(function (k) {
    report.push((props.getProperty(k) ? '✔ ' : '✘ ') + k + (props.getProperty(k) ? '' : ' 가 설정되지 않았습니다.'));
  });
  try {
    const d = platform_().store.get(COL.PUBLIC, 'revision');
    report.push('✔ Firestore 연결 성공' + (d ? ' (rev=' + d.rev + ')' : ' (아직 초기화 전)'));
  } catch (e) {
    report.push('✘ Firestore 연결 실패: ' + e.message);
  }
  try {
    const r = platform_().auth.verifyPassword(authEmailFor_('config-check-' + randomHex_(4)), 'Invalid-Password-123!');
    report.push(r.reason === 'INVALID' ? '✔ Firebase Authentication 연결 성공 (이메일/비밀번호 로그인 활성)' : '✘ Firebase Authentication 응답 이상: ' + r.reason);
  } catch (e) {
    report.push('✘ Firebase Authentication 연결 실패: ' + e.message);
  }
  console.log(report.join('\n'));
  return report;
}

function initializeDatabase() {
  const r = seedDatabase_('owner');
  console.log('생성: ' + r.created.length + '건\n' + r.created.join('\n') + '\n건너뜀(이미 존재): ' + r.skipped.length + '건');
  return r;
}

function enableInitialSetup() {
  const system = platform_().store.get(COL.SETTINGS, 'system');
  if (system && system.bootstrappedAt) {
    console.log('이미 최초 관리자가 생성되었습니다. 비밀번호를 잊은 경우 enableAdminRecovery() 를 사용하세요.');
    return;
  }
  const token = randomHex_(12);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SETUP_TOKEN', token);
  props.setProperty('SETUP_TOKEN_EXPIRES', String(Date.now() + 30 * 60000));
  console.log('최초 관리자 설정 토큰 (30분 유효, 1회용):\n\n    ' + token + '\n\n포털의 /setup 화면에 입력하고 profcys 계정의 비밀번호를 지정하세요. 이 토큰은 사용 즉시 삭제됩니다.');
}

function enableAdminRecovery() {
  const token = randomHex_(12);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('RECOVERY_TOKEN', token);
  props.setProperty('RECOVERY_TOKEN_EXPIRES', String(Date.now() + 30 * 60000));
  console.log('관리자 복구 토큰 (30분 유효, 1회용):\n\n    ' + token + '\n\n포털의 /recover 화면에서 최고관리자 아이디와 새 비밀번호를 입력하세요.');
}

function getOrCreateSheet_(name) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('BACKUP_SPREADSHEET_ID');
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('PROFCYS Gateway 백업·통계');
    props.setProperty('BACKUP_SPREADSHEET_ID', ss.getId());
  }
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return { ss: ss, sh: sh };
}

function writeRows_(sheetName, header, rows) {
  const o = getOrCreateSheet_(sheetName);
  o.sh.clearContents();
  const data = [header].concat(rows);
  o.sh.getRange(1, 1, data.length, header.length).setValues(data);
  return o.ss.getUrl();
}

/** 비밀번호·인증 이메일·세션·인증 키는 포함하지 않는다 */
function exportBackupToSheet() {
  const users = listAllUsers_();
  const fmt = function (ms) { return ms ? Utilities.formatDate(new Date(ms), PROFCYS.TIMEZONE, 'yyyy.MM.dd HH:mm') : ''; };
  writeRows_('users_' + kstDateKey_(Date.now()), ['uid', 'username', 'displayName', 'organization', 'department', 'position', 'email', 'phone', 'role', 'status', 'allowedServices', 'validFrom', 'validUntil', 'createdAt', 'lastLoginAt'],
    users.map(function (u) { return [u.uid, u.username, u.displayName, u.organization || '', u.department || '', u.position || '', u.email || '', u.phone || '', u.role, u.status, (u.allowedServices || []).join(';'), u.validFrom || '', u.validUntil || '', fmt(u.createdAt), fmt(u.lastLoginAt)]; }));
  const c = loadCatalog_();
  const url = writeRows_('services_' + kstDateKey_(Date.now()), ['serviceId', 'serviceName', 'url', 'status', 'categoryId', 'sortOrder', 'authenticationMode', 'integrationStatus', 'securityVerified', 'json'],
    c.services.map(function (s) { return [s.serviceId, s.serviceName, s.url, s.status, s.categoryId, s.sortOrder, s.authenticationMode, s.integrationStatus, !!s.securityVerified, JSON.stringify(s).substring(0, 45000)]; }));
  writeRows_('settings_' + kstDateKey_(Date.now()), ['key', 'json'], [['platform', JSON.stringify(c.settings)], ['ui', JSON.stringify(c.ui)], ['categories', JSON.stringify(c.categories)]]);
  console.log('백업 완료: ' + url);
  return url;
}

function exportStatsToSheet() {
  const t = Date.now();
  const days = getDailyStats_(kstDateKey_(t - 365 * 86400000), kstDateKey_(t));
  const rows = [];
  days.forEach(function (d) {
    const base = [d.date, Object.keys(d.loginUsers || {}).length, d.loginSuccess || 0, d.loginFailure || 0, d.accessDenied || 0, d.serviceLaunchTotal || 0];
    rows.push(base.concat(['(전체)', '', '']));
    Object.keys(d.serviceLaunch || {}).forEach(function (sid) {
      rows.push(base.concat([sid, (d.serviceLaunch || {})[sid] || 0, (d.serviceAuthSuccess || {})[sid] || 0]));
    });
  });
  const url = writeRows_('stats_daily', ['date', 'loginUsers', 'logins', 'loginFailures', 'accessDenied', 'serviceLaunchTotal', 'serviceId', 'serviceLaunch', 'serviceAuthSuccess'], rows);
  console.log('통계 내보내기 완료 (Looker Studio 에서 이 시트를 데이터 소스로 연결): ' + url);
  return url;
}

function cleanupExpiredRecords() {
  const store = platform_().store;
  const t = Date.now();
  const settings = getSettings_();
  let n = 0;
  const purge = function (col, field, before) {
    const docs = store.list(col, { where: [[field, '<', before]], limit: 400 });
    store.commit(docs.map(function (d) { return { type: 'delete', col: col, id: d._id }; }));
    n += docs.length;
  };
  purge(COL.AUTH_CODES, 'expiresAt', t - 86400000);
  purge(COL.SESSIONS, 'expiresAt', t - 86400000);
  purge(COL.ACCESS_LOGS, 'timestamp', t - settings.logRetentionDays * 86400000);
  console.log('정리된 문서: ' + n + '건');
  return n;
}

function installMaintenanceTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (['cleanupExpiredRecords', 'exportStatsToSheet', 'exportBackupToSheet'].indexOf(tr.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('cleanupExpiredRecords').timeBased().everyDays(1).atHour(3).inTimezone(PROFCYS.TIMEZONE).create();
  ScriptApp.newTrigger('exportStatsToSheet').timeBased().everyDays(1).atHour(4).inTimezone(PROFCYS.TIMEZONE).create();
  ScriptApp.newTrigger('exportBackupToSheet').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).inTimezone(PROFCYS.TIMEZONE).create();
  console.log('트리거 설치 완료: 매일 03시 정리, 04시 통계 내보내기, 매주 월요일 05시 백업 (한국시간)');
}

/**
 * Firebase 웹 앱 설정(공개 클라이언트 값)에서 Web API Key 를 조회한다. 소유자 OAuth 토큰으로 Firebase Management API 를 호출.
 * 키를 사람이 복사·붙여넣기하지 않아도 되도록 checkConfiguration() 이 속성이 비어 있을 때 사용한다.
 */
function discoverFirebaseWebApiKey_(projectId) {
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': projectId };
  const get = function (url) {
    const res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' ' + res.getContentText().substring(0, 200));
    return JSON.parse(res.getContentText());
  };
  const base = 'https://firebase.googleapis.com/v1beta1/projects/' + encodeURIComponent(projectId);
  const apps = (get(base + '/webApps').apps || []).filter(function (a) { return a.state !== 'DELETED'; });
  if (!apps.length) throw new Error('등록된 웹 앱이 없습니다.');
  const cfg = get(base + '/webApps/' + encodeURIComponent(apps[0].appId) + '/config');
  if (!cfg.apiKey) throw new Error('웹 앱 설정에 apiKey 가 없습니다.');
  return cfg.apiKey;
}
