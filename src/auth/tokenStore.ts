/**
 * 세션 토큰 저장소
 *
 * - 비밀번호는 어디에도 저장하지 않는다. 저장하는 것은 서버가 발급한 무작위 세션 토큰뿐이며,
 *   서버는 토큰의 해시만 보관하고 매 요청마다 유효성·계정 상태·권한을 다시 검증한다.
 * - localStorage 를 사용하여 새로고침 시 로그인 상태를 복원하고, storage 이벤트로 여러 탭의 로그아웃을 일치시킨다.
 */
const KEY = 'profcys.session.v1';

let memoryToken: string | null = null;

function safeGet(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memoryToken;
  }
}

export function getToken(): string | null {
  const raw = safeGet();
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { t: string };
    return typeof v.t === 'string' ? v.t : null;
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  memoryToken = token ? JSON.stringify({ t: token }) : null;
  try {
    if (token) localStorage.setItem(KEY, JSON.stringify({ t: token }));
    else localStorage.removeItem(KEY);
  } catch {
    /* 사생활 보호 모드 등: 메모리에만 유지 */
  }
}

/** 다른 탭에서 로그인/로그아웃이 일어나면 호출 */
export function onTokenChange(fn: (token: string | null) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === KEY) fn(getToken());
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

const REMEMBER_KEY = 'profcys.rememberedUsername';
/** "아이디 기억하기": 아이디만 저장 (비밀번호는 저장하지 않음) */
export function getRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}
export function setRememberedUsername(username: string | null): void {
  try {
    if (username) localStorage.setItem(REMEMBER_KEY, username);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* noop */
  }
}
