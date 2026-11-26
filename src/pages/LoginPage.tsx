/** 통합 로그인 화면 (8장) — 자체 회원가입 없음, 관리자가 발급한 아이디·비밀번호로만 로그인 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getRememberedUsername, setRememberedUsername } from '../auth/tokenStore';
import { api, ApiError } from '../services/api';
import { Alert, Check, Icon, Logo, PasswordField, Spinner, TextField } from '../components/ui';
import { BRAND } from '../config/env';
import type { PlatformInfo } from '../types';

interface PublicInfo { platform: PlatformInfo; initialized: boolean; setupEnabled: boolean; recoveryEnabled: boolean }

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-hero" aria-hidden="true">
        <div className="logo">
          <span className="logo-mark">P</span>
          <span className="logo-text"><strong>{BRAND.name}</strong><span>Integrated Business Support Platform</span></span>
        </div>
        <div>
          <h1>하나의 계정으로,<br />모든 업무지원 서비스를.</h1>
          <p>PROFCYS 통합 업무지원 플랫폼은 공동 업무, 멘토링, 창업 지원, 심사 업무를 하나의 안전한 포털에서 이용할 수 있도록 연결합니다.</p>
        </div>
        <div className="small" style={{ opacity: 0.6 }}>{BRAND.platformEn}</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

export function usePublicInfo() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    api<PublicInfo>('publicInfo', {}, { token: null }).then(setInfo).catch(() => setInfo(null));
  }, []);
  return info;
}

export default function LoginPage() {
  const { status, user, login, endReason } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const info = usePublicInfo();
  const remembered = getRememberedUsername();
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!remembered);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const from = (loc.state as { from?: string } | null)?.from || '/';

  if (status === 'authenticated' && user) return <Navigate to={user.mustChangePassword ? '/account/password' : from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('아이디와 비밀번호를 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const u = await login(username.trim(), password);
      setRememberedUsername(remember ? username.trim() : null);
      setPassword('');
      nav(u.mustChangePassword ? '/account/password' : from, { replace: true });
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError) {
        const remaining = err.details && typeof err.details.remainingAttempts === 'number' ? ` (남은 시도 ${err.details.remainingAttempts}회)` : '';
        setError(err.message + remaining);
      } else setError('로그인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div className="brand-mobile"><Logo /></div>
      <h1 style={{ fontSize: 22 }}>{BRAND.platformKo}</h1>
      <p className="muted small" style={{ marginBottom: 22 }}>{BRAND.platformEn}</p>
      {info?.setupEnabled && !info.initialized && (
        <Alert kind="info">최초 관리자 계정이 아직 없습니다. <Link to="/setup">최초 관리자 설정</Link>을 진행하세요.</Alert>
      )}
      {info?.platform.maintenanceMode && <Alert kind="warn" icon="construction">{info.platform.maintenanceMessage || '플랫폼 점검 중입니다.'}</Alert>}
      {endReason && !error && <div style={{ marginBottom: 12 }}><Alert kind="info">{endReason}</Alert></div>}
      <form onSubmit={submit} className="stack" noValidate aria-describedby={error ? 'login-error' : undefined}>
        <TextField label="아이디" value={username} onChange={setUsername} autoComplete="username" required maxLength={64} placeholder="관리자가 발급한 아이디" />
        <PasswordField label="비밀번호" value={password} onChange={setPassword} autoComplete="current-password" required />
        <Check label="아이디 기억하기" checked={remember} onChange={setRemember} />
        {error && <div id="login-error"><Alert kind="error">{error}</Alert></div>}
        <button type="submit" className="btn block navy" disabled={busy} style={{ minHeight: 46 }}>
          {busy ? <><Spinner small label="로그인 처리 중" /> 로그인 중…</> : <><Icon name="login" /> 로그인</>}
        </button>
      </form>
      <div className="alert" style={{ marginTop: 18 }}>
        <Icon name="support_agent" />
        <div className="small">
          계정 발급, 비밀번호 분실, 계정 잠금은 관리자에게 문의하세요.<br />
          <span className="muted">{info?.platform.supportContact || 'PROFCYS 플랫폼 관리자'}</span>
        </div>
      </div>
      <div className="auth-foot">
        {info?.platform.copyright || '© PROFCYS. All rights reserved.'}
        {info?.recoveryEnabled && <> · <Link to="/recover">관리자 계정 복구</Link></>}
      </div>
    </AuthFrame>
  );
}
