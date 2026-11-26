/** 최초 관리자 설정(9장) 및 관리자 계정 복구 화면 — 스크립트 소유자가 발급한 일회용 토큰이 있어야만 동작 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../services/api';
import { Alert, Icon, Logo, PasswordField, Spinner, TextField } from '../components/ui';
import { AuthFrame, usePublicInfo } from './LoginPage';
import { PasswordChecklist, passwordProblems } from '../components/PasswordChecklist';

export function SetupPage() {
  const info = usePublicInfo();
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const problems = passwordProblems(pw, 12, 'profcys');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length || pw !== pw2) return;
    setBusy(true);
    setError('');
    try {
      await api('bootstrap', { setupToken: token.trim(), password: pw }, { token: null });
      setDone(true);
      setPw('');
      setPw2('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame>
      <div className="brand-mobile"><Logo /></div>
      <h1 style={{ fontSize: 22 }}>최초 관리자 설정</h1>
      {done ? (
        <div className="stack">
          <Alert kind="ok">최고관리자 계정 <strong>profcys</strong> 가 생성되었고 초기 데이터가 등록되었습니다. 설정 토큰은 자동으로 폐기되었습니다.</Alert>
          <Link className="btn navy block" to="/login">로그인하러 가기</Link>
        </div>
      ) : info && info.initialized ? (
        <Alert kind="info">최초 관리자 계정이 이미 존재합니다. 기존 비밀번호는 변경되지 않습니다. <Link to="/login">로그인</Link></Alert>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="muted small">
            Apps Script 편집기에서 <code>enableInitialSetup()</code> 을 실행하면 실행 로그에 30분 동안 유효한 일회용 설정 토큰이 표시됩니다.
            토큰과 함께 최고관리자 <strong>profcys</strong> 의 비밀번호를 직접 지정하세요. 비밀번호는 Firebase Authentication 에만 전달되며 어디에도 저장되지 않습니다.
          </p>
          <TextField label="설정 토큰" value={token} onChange={setToken} autoComplete="off" required />
          <TextField label="관리자 아이디" value="profcys" onChange={() => undefined} disabled />
          <PasswordField label="관리자 비밀번호" value={pw} onChange={setPw} autoComplete="new-password" required />
          <PasswordChecklist password={pw} minLength={12} username="profcys" />
          <PasswordField label="비밀번호 확인" value={pw2} onChange={setPw2} autoComplete="new-password" required error={pw2 && pw !== pw2 ? '비밀번호가 일치하지 않습니다.' : undefined} />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn navy block" type="submit" disabled={busy || !token || problems.length > 0 || pw !== pw2}>
            {busy ? <Spinner small /> : <Icon name="admin_panel_settings" />} 최고관리자 생성
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

export function RecoverPage() {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('profcys');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const problems = passwordProblems(pw, 12, username);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('recoverAdmin', { recoveryToken: token.trim(), username, newPassword: pw }, { token: null });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame>
      <div className="brand-mobile"><Logo /></div>
      <h1 style={{ fontSize: 22 }}>관리자 계정 복구</h1>
      {done ? (
        <div className="stack">
          <Alert kind="ok">비밀번호가 재설정되었습니다. 기존 로그인 세션은 모두 종료되었으며, 로그인 후 비밀번호를 다시 변경해야 합니다.</Alert>
          <Link className="btn navy block" to="/login">로그인하러 가기</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="muted small">스크립트 소유자만 Apps Script 편집기에서 <code>enableAdminRecovery()</code> 를 실행해 복구 토큰(30분 유효)을 발급할 수 있습니다. 최고관리자 계정만 복구할 수 있습니다.</p>
          <TextField label="복구 토큰" value={token} onChange={setToken} autoComplete="off" required />
          <TextField label="최고관리자 아이디" value={username} onChange={setUsername} autoComplete="username" required />
          <PasswordField label="새 비밀번호" value={pw} onChange={setPw} autoComplete="new-password" required />
          <PasswordChecklist password={pw} minLength={12} username={username} />
          <PasswordField label="새 비밀번호 확인" value={pw2} onChange={setPw2} autoComplete="new-password" required error={pw2 && pw !== pw2 ? '비밀번호가 일치하지 않습니다.' : undefined} />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn navy block" type="submit" disabled={busy || !token || problems.length > 0 || pw !== pw2}>{busy && <Spinner small />} 비밀번호 재설정</button>
          <Link to="/login" className="small">로그인 화면으로</Link>
        </form>
      )}
    </AuthFrame>
  );
}
