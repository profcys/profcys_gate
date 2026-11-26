/** 날짜·시간 표시 (Asia/Seoul, YYYY.MM.DD, 24시간제) */
const TZ = 'Asia/Seoul';

function parts(ms: number) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '-';
  const p = parts(ms);
  return `${p.year}.${p.month}.${p.day}`;
}

export function fmtDateTime(ms: number | null | undefined, withSeconds = false): string {
  if (!ms) return '-';
  const p = parts(ms);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}${withSeconds ? ':' + p.second : ''}`;
}

/** 'YYYY-MM-DD' (입력 필드 값) → 'YYYY.MM.DD' */
export function fmtDateStr(s: string | null | undefined): string {
  if (!s) return '-';
  return s.replace(/-/g, '.');
}

/** 오늘 날짜 'YYYY-MM-DD' (한국시간) */
export function todayKey(offsetDays = 0): string {
  const p = parts(Date.now() + offsetDays * 86400000);
  return `${p.year}-${p.month}-${p.day}`;
}

/** ms → datetime-local 입력값 (한국시간) */
export function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return '';
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** datetime-local 입력값(한국시간 기준) → ms */
export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600 * 1000;
}

export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '-';
  const d = Math.round((now - ms) / 1000);
  if (d < 60) return '방금 전';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`;
  return fmtDate(ms);
}

export const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: '최고관리자', ADMIN: '운영관리자', USER: '일반 사용자' };
export const ACCOUNT_STATUS_LABEL: Record<string, string> = { ACTIVE: '활성', INACTIVE: '비활성' };
export const SERVICE_STATUS_LABEL: Record<string, string> = {
  DRAFT: '등록 초안', ACTIVE: '공개', SCHEDULED: '예약 공개', MAINTENANCE: '점검 중', INACTIVE: '비활성', ARCHIVED: '보관', EXPIRED: '공개 종료',
};
export const CARD_STATE_LABEL: Record<string, string> = { AVAILABLE: '이용 가능', LOCKED: '접근 제한', MAINTENANCE: '점검 중', STOPPED: '이용 중지' };
export const AUTH_MODE_LABEL: Record<string, string> = {
  EXTERNAL_SELF: '외부 서비스 자체 인증',
  PORTAL_ONLY: 'PROFCYS 포털 접근 제어',
  GOOGLE_ACCOUNT: 'Google 계정 인증',
  PROFCYS_SSO: 'PROFCYS 통합 인증 적용',
  SSO_REQUIRED: '인증 연동 필요',
  UNVERIFIED: '보안 검증 미완료',
};
export const INTEGRATION_LABEL: Record<string, string> = {
  LINK_ONLY: '링크 연결 완료',
  PORTAL_ACCESS_CONTROL: '포털 접근 권한 적용 완료',
  SSO_PENDING: '기존 서비스 내부 인증 연동 미완료',
  SSO_ENABLED: '통합 인증 적용 (직접 접근 차단 미검증)',
  FULL_SSO: '완전한 통합 인증 완료',
};
export const DIRECT_ACCESS_LABEL: Record<string, string> = { UNVERIFIED: '직접 URL 접근 차단 미검증', BLOCKED: '직접 URL 접근 차단 확인', OPEN: '직접 URL 접근 가능 (차단 안 됨)' };
export const SERVICE_TYPE_LABEL: Record<string, string> = {
  APPS_SCRIPT: 'Google Apps Script 웹앱', GOOGLE_FORMS: 'Google Forms', GOOGLE_SHEETS: 'Google Sheets', GOOGLE_DOCS: 'Google Docs',
  GOOGLE_SLIDES: 'Google Slides', GOOGLE_DRIVE: 'Google Drive', GOOGLE_SITES: 'Google Sites', LOOKER_STUDIO: 'Looker Studio',
  FIREBASE_HOSTING: 'Firebase Hosting 웹앱', GOOGLE_CLOUD: 'Google Cloud 웹앱', AI_SERVICE: 'AI 업무지원 서비스', EXTERNAL: '외부 HTTPS 웹앱', OTHER: '기타 승인 시스템',
};
export const OPEN_MODE_LABEL: Record<string, string> = { NEW_TAB: '새 브라우저 탭', SAME_TAB: '현재 탭', EMBED: '플랫폼 내부 임베딩', SSO: '인증 연동 후 실행' };
export const ACCESS_ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: '로그인 성공', LOGIN_FAILURE: '로그인 실패', LOGOUT: '로그아웃', SESSION_EXPIRED: '세션 만료',
  SERVICE_LAUNCH: '서비스 접속 요청(포털)', SERVICE_AUTH_SUCCESS: '서비스 인증 성공(업무 시스템)', SERVICE_AUTH_FAILURE: '서비스 인증 실패',
  ACCESS_DENIED: '접근 권한 거부', PASSWORD_CHANGE: '비밀번호 변경', ACCOUNT_STATUS_CHANGE: '계정 상태 변경',
};
export const ANNOUNCEMENT_CATEGORY_LABEL: Record<string, string> = {
  GENERAL: '일반 공지', IMPORTANT: '중요 공지', UPDATE: '시스템 업데이트', MAINTENANCE: '서비스 점검', GUIDE: '이용 안내', SECURITY: '보안 안내',
};
