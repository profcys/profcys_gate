/**
 * PROFCYS Gateway API 클라이언트
 *
 * - 요청: POST text/plain (Apps Script 웹앱이 CORS 사전 요청을 지원하지 않으므로 "단순 요청"으로 전송)
 * - 인증 토큰은 쿠키가 아닌 요청 본문으로만 전달 → CSRF 불가
 * - 세션 관련 오류 코드는 전역 이벤트로 알려 모든 화면에서 즉시 로그아웃 처리
 */
import { config } from '../config/env';
import { getToken } from '../auth/tokenStore';

export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;
  errorId?: string;
  at?: number;
  constructor(code: string, message: string, extra?: { details?: Record<string, unknown>; errorId?: string; at?: number }) {
    super(message);
    this.code = code;
    this.details = extra?.details;
    this.errorId = extra?.errorId;
    this.at = extra?.at;
  }
}

/** 이 코드를 받으면 현재 로그인 상태를 즉시 종료한다 */
export const SESSION_END_CODES = [
  'AUTH_REQUIRED', 'SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REVOKED',
  'ACCOUNT_DISABLED', 'ACCOUNT_EXPIRED', 'ACCOUNT_NOT_STARTED', 'ACCOUNT_LOCKED', 'ACCOUNT_NOT_FOUND',
];

type Listener = (err: ApiError) => void;
const sessionEndListeners = new Set<Listener>();
export function onSessionEnd(fn: Listener): () => void {
  sessionEndListeners.add(fn);
  return () => sessionEndListeners.delete(fn);
}

let lastCallAt = 0;
export function lastApiCallAt(): number {
  return lastCallAt;
}

export async function api<T = unknown>(action: string, params: Record<string, unknown> = {}, opts: { token?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const token = opts.token !== undefined ? opts.token : getToken();
  const body = JSON.stringify({ action, params, token: token || undefined, meta: { ua: navigator.userAgent.slice(0, 160) } });
  let res: Response;
  try {
    res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE', navigator.onLine ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' : '네트워크 연결이 없습니다. 연결 상태를 확인하세요.');
  }
  let json: { ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown>; errorId?: string; at?: number } };
  try {
    json = await res.json();
  } catch {
    throw new ApiError('SERVER_ERROR', '서버 응답을 해석할 수 없습니다. 잠시 후 다시 시도하세요.');
  }
  if (action !== 'sync') lastCallAt = Date.now();
  if (!json.ok) {
    const e = json.error || { code: 'SERVER_ERROR', message: '요청을 처리하지 못했습니다.' };
    const err = new ApiError(e.code, e.message, { details: e.details, errorId: e.errorId, at: e.at });
    if (token && SESSION_END_CODES.includes(err.code) && action !== 'login') {
      sessionEndListeners.forEach((fn) => fn(err));
    }
    throw err;
  }
  return json.data as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    return e.errorId ? `${e.message} (오류 코드: ${e.errorId})` : e.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}
