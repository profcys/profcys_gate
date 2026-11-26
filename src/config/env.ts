/**
 * 프런트엔드 설정값. 모두 공개 클라이언트 설정값이며 비밀정보가 아니다.
 * (Firebase Web API Key 는 프로젝트 식별용 공개 값이다. 보안은 서버 검증과 Firestore Rules 로 보장한다.)
 */
const env = import.meta.env;

export const config = {
  /** Apps Script gateway-api 웹앱 URL. 개발 서버에서는 /api */
  apiUrl: (env.VITE_API_URL as string | undefined) || '/api',
  firebase: {
    projectId: (env.VITE_FIREBASE_PROJECT_ID as string | undefined) || '',
    apiKey: (env.VITE_FIREBASE_API_KEY as string | undefined) || '',
    appId: (env.VITE_FIREBASE_APP_ID as string | undefined) || '',
  },
  portalUrl: (env.VITE_PORTAL_URL as string | undefined) || '',
  /** 백그라운드 변경 확인 주기 (Firestore 실시간 구독을 쓰지 못할 때) */
  pollIntervalMs: 90_000,
  timezone: 'Asia/Seoul',
} as const;

export const BRAND = {
  name: 'PROFCYS',
  platformKo: 'PROFCYS 통합 업무지원 플랫폼',
  platformEn: 'PROFCYS Integrated Business Support Platform',
  short: 'PROFCYS Gateway',
};
