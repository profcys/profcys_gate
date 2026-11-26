/**
 * 인증 상태 관리
 *
 * - 새로고침 시: 저장된 세션 토큰으로 서버에 session 요청 → 서버가 계정 상태·권한을 재검증한 경우에만 로그인 상태 복원
 * - 비활성 자동 로그아웃: 사용자 활동(마우스·키보드·터치)이 없으면 서버 설정(기본 60분) 후 로그아웃, 5분 전 안내
 * - 활동 중이면 서버에 touch 를 보내 서버측 비활성 타이머도 연장 (서버도 독립적으로 만료를 검증)
 * - 여러 탭: localStorage storage 이벤트로 로그아웃/로그인 상태를 즉시 동기화
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, lastApiCallAt, onSessionEnd } from '../services/api';
import { getToken, onTokenChange, setToken } from './tokenStore';
import type { PlatformInfo, SessionInfo, User } from '../types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  user: User | null;
  session: SessionInfo | null;
  platform: PlatformInfo | null;
  /** 로그아웃 사유 (로그인 화면에 표시) */
  endReason: string | null;
}

interface AuthApi extends AuthState {
  login: (username: string, password: string) => Promise<User>;
  logout: (reason?: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (u: User) => void;
  idleWarning: number | null;
  extendSession: () => void;
}

const Ctx = createContext<AuthApi | null>(null);

interface LoginResponse { token: string; user: User; session: SessionInfo; mustChangePassword: boolean }
interface SessionResponse { user: User; session: SessionInfo; platform: PlatformInfo; mustChangePassword: boolean }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, session: null, platform: null, endReason: null });
  const [idleWarning, setIdleWarning] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const lastTouch = useRef(Date.now());

  const clear = useCallback((reason: string | null) => {
    setToken(null);
    setIdleWarning(null);
    setState((s) => ({ status: 'anonymous', user: null, session: null, platform: s.platform, endReason: reason }));
  }, []);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setState((s) => ({ ...s, status: 'anonymous', user: null, session: null }));
      return;
    }
    try {
      const r = await api<SessionResponse>('session');
      lastActivity.current = Date.now();
      setState({ status: 'authenticated', user: r.user, session: r.session, platform: r.platform, endReason: null });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'NETWORK_ERROR' || e.code === 'OFFLINE')) {
        // 네트워크 오류 시 인증 상태를 임의로 유지하지 않는다 (오프라인에서 보호 기능 접근 차단)
        setState((s) => ({ ...s, status: 'anonymous', user: null, session: null, endReason: e.message }));
        return;
      }
      clear(e instanceof ApiError ? e.message : null);
    }
  }, [clear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 서버가 세션 종료를 알리면 즉시 로그아웃
  useEffect(() => onSessionEnd((err) => clear(err.message)), [clear]);

  // 다른 탭과 로그인 상태 동기화
  useEffect(
    () =>
      onTokenChange((token) => {
        if (!token) clear('다른 창에서 로그아웃되었습니다.');
        else void refresh();
      }),
    [clear, refresh],
  );

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<LoginResponse>('login', { username, password }, { token: null });
    setToken(r.token);
    lastActivity.current = Date.now();
    lastTouch.current = Date.now();
    setState((s) => ({ status: 'authenticated', user: r.user, session: r.session, platform: s.platform, endReason: null }));
    return r.user;
  }, []);

  const logout = useCallback(async (reason?: string) => {
    try {
      if (getToken()) await api('logout');
    } catch {
      /* 서버 세션이 이미 만료된 경우에도 클라이언트 상태는 정리 */
    }
    clear(reason || null);
  }, [clear]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const r = await api<LoginResponse>('changePassword', { currentPassword, newPassword });
    setToken(r.token);
    setState((s) => ({ ...s, status: 'authenticated', user: r.user, session: r.session }));
  }, []);

  const updateUser = useCallback((u: User) => setState((s) => ({ ...s, user: u })), []);

  // ── 비활성 감시 ──
  useEffect(() => {
    if (state.status !== 'authenticated' || !state.session) return;
    const session = state.session;
    const idleMs = session.idleTimeoutMin * 60_000;
    const warnMs = Math.min(idleMs - 30_000, (session.idleTimeoutMin - session.warningMinutes) * 60_000);
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel', 'visibilitychange'];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      const now = Date.now();
      const sinceActivity = now - Math.max(lastActivity.current, lastApiCallAt() || 0);
      if (now >= session.expiresAt) {
        void logout('최대 로그인 시간이 지나 자동 로그아웃되었습니다.');
        return;
      }
      if (sinceActivity >= idleMs) {
        void logout('장시간 사용하지 않아 자동 로그아웃되었습니다.');
        return;
      }
      if (sinceActivity >= warnMs) {
        setIdleWarning(Math.max(0, Math.ceil((idleMs - sinceActivity) / 1000)));
      } else {
        setIdleWarning(null);
        const lastServer = Math.max(lastTouch.current, lastApiCallAt() || 0);
        // 사용자가 활동 중인데 서버 호출이 4분 이상 없었다면 서버측 활동 시간 갱신
        if (now - lastActivity.current < 60_000 && now - lastServer > 4 * 60_000) {
          lastTouch.current = now;
          api('touch').catch(() => undefined);
        }
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, [state.status, state.session, logout]);

  const extendSession = useCallback(() => {
    lastActivity.current = Date.now();
    lastTouch.current = Date.now();
    setIdleWarning(null);
    api('touch').catch(() => undefined);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ ...state, login, logout, changePassword, refresh, updateUser, idleWarning, extendSession }),
    [state, login, logout, changePassword, refresh, updateUser, idleWarning, extendSession],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

export function isAdmin(u: User | null | undefined): boolean {
  return !!u && (u.role === 'SUPER_ADMIN' || u.role === 'ADMIN');
}

export function isSuperAdmin(u: User | null | undefined): boolean {
  return !!u && u.role === 'SUPER_ADMIN';
}
