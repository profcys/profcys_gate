/**
 * PROFCYS Gateway API — 공통 상수
 * 파일: apps-script/gateway-api/00_Constants.js
 *
 * Apps Script 는 모든 .js 파일을 하나의 전역 스코프로 합쳐 실행한다.
 * 파일명 앞의 숫자는 로딩 순서를 명확히 하기 위한 것이다 (Apps Script 는 파일 순서대로 로드).
 */

const PROFCYS = Object.freeze({
  PLATFORM_NAME: 'PROFCYS 통합 업무지원 플랫폼',
  PLATFORM_NAME_EN: 'PROFCYS Integrated Business Support Platform',
  SHORT_NAME: 'PROFCYS Gateway',
  API_VERSION: '3.0.0',
  TIMEZONE: 'Asia/Seoul',
  INITIAL_ADMIN_USERNAME: 'profcys',
  INITIAL_ADMIN_DISPLAY_NAME: 'PROFCYS 관리자',
});

const ROLES = Object.freeze({ SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', USER: 'USER' });
const ROLE_LIST = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.USER];

const ACCOUNT_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' });

const SERVICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SCHEDULED: 'SCHEDULED',
  MAINTENANCE: 'MAINTENANCE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
});
const SERVICE_STATUS_LIST = Object.keys(SERVICE_STATUS);

/** 서비스 인증 방식 (16장) */
const AUTH_MODES = ['EXTERNAL_SELF', 'PORTAL_ONLY', 'GOOGLE_ACCOUNT', 'PROFCYS_SSO', 'SSO_REQUIRED', 'UNVERIFIED'];
/** 연동 상태 (21장 "기존 시스템 수정 권한이 없는 경우") */
const INTEGRATION_STATUS = ['LINK_ONLY', 'PORTAL_ACCESS_CONTROL', 'SSO_PENDING', 'SSO_ENABLED', 'FULL_SSO'];
const OPEN_MODES = ['NEW_TAB', 'SAME_TAB', 'EMBED', 'SSO'];
const DIRECT_ACCESS_STATES = ['UNVERIFIED', 'BLOCKED', 'OPEN'];
const SSO_TRANSPORTS = ['POST', 'QUERY'];
const CARD_STYLES = ['default', 'icon', 'thumbnail', 'list', 'color'];
const POLICY_MODES = ['NONE', 'ALL', 'ADMINS', 'RULES'];

const SERVICE_TYPES = [
  'APPS_SCRIPT', 'GOOGLE_FORMS', 'GOOGLE_SHEETS', 'GOOGLE_DOCS', 'GOOGLE_SLIDES', 'GOOGLE_DRIVE',
  'GOOGLE_SITES', 'LOOKER_STUDIO', 'FIREBASE_HOSTING', 'GOOGLE_CLOUD', 'AI_SERVICE', 'EXTERNAL', 'OTHER',
];

const ACCESS_ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SERVICE_LAUNCH: 'SERVICE_LAUNCH',
  SERVICE_AUTH_SUCCESS: 'SERVICE_AUTH_SUCCESS',
  SERVICE_AUTH_FAILURE: 'SERVICE_AUTH_FAILURE',
  ACCESS_DENIED: 'ACCESS_DENIED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  ACCOUNT_STATUS_CHANGE: 'ACCOUNT_STATUS_CHANGE',
});

/** Firestore 컬렉션 이름 (22장) */
const COL = Object.freeze({
  USERS: 'users',
  USERNAME_MAPPINGS: 'usernameMappings',
  SERVICES: 'services',
  SERVICE_SECRETS: 'serviceSecrets',
  CATEGORIES: 'serviceCategories',
  ACCESS_LOGS: 'accessLogs',
  ADMIN_LOGS: 'adminLogs',
  SERVICE_CHANGE_LOGS: 'serviceChangeLogs',
  ANNOUNCEMENTS: 'announcements',
  PREFS: 'userPreferences',
  SETTINGS: 'settings', // 문서: platform, ui, system
  SESSIONS: 'authSessions',
  AUTH_CODES: 'authCodes',
  LOGIN_GUARDS: 'loginGuards',
  STATS_DAILY: 'statsDaily',
  PUBLIC: 'public', // 문서: revision (비밀정보 없음, 공개 읽기 허용)
});

/** 비밀번호 정책 (23장) — 흔히 쓰이는 취약 비밀번호 목록 (소문자 비교) */
const COMMON_PASSWORDS = [
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'qwerty', 'qwerty123',
  'qwertyuiop', '123456', '1234567', '12345678', '123456789', '1234567890', '123123123', '111111111111',
  'abc123', 'abcd1234', 'abcdefghijkl', 'admin', 'admin123', 'admin1234', 'administrator', 'letmein',
  'welcome', 'welcome1', 'welcome123', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
  'dragon', 'master', 'monkey', 'shadow', 'superman', 'trustno1', 'zaq12wsx', '1q2w3e4r', '1q2w3e4r5t',
  '1q2w3e4r5t6y', 'q1w2e3r4', 'asdfghjkl', 'asdf1234', 'zxcvbnm', 'changeme', 'profcys', 'profcys123',
  'profcys1234', 'profcys12345', 'profcysadmin', 'gateway123',
];

/** 예약된 사용자 아이디 (최초 관리자는 부트스트랩 과정에서만 생성) */
const RESERVED_USERNAMES = ['admin', 'administrator', 'root', 'system', 'support', 'null', 'undefined', 'anonymous', 'superadmin'];

const DEFAULT_ALLOWED_SERVICE_DOMAINS = [
  'script.google.com', 'script.googleusercontent.com', 'docs.google.com', 'drive.google.com', 'sites.google.com',
  'forms.gle', 'lookerstudio.google.com', 'datastudio.google.com', 'web.app', 'firebaseapp.com', 'run.app', 'appspot.com',
];
