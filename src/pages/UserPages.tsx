/** 사용자 화면: 대시보드, 계정 정보, 비밀번호 변경, 임베딩 실행, 이용 안내 (18·21장) */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError, errorText } from '../services/api';
import { subscribeRevision } from '../services/revision';
import { launchService } from '../services/launch';
import { AppHeader } from '../layouts/AppHeader';
import { DashboardView } from '../components/DashboardView';
import { Alert, Badge, Icon, Loading, PasswordField, Spinner, useToast } from '../components/ui';
import { PasswordChecklist, passwordProblems } from '../components/PasswordChecklist';
import { fmtDateStr, fmtDateTime, ROLE_LABEL } from '../utils/format';
import type { DashboardData, LaunchResult, ServiceCard } from '../types';

interface DashCtx {
  data: DashboardData | null;
  error: string;
  reload: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<DashboardData | null>>;
}
const DashboardContext = createContext<DashCtx>({ data: null, error: '', reload: async () => undefined, setData: () => undefined });
export const useDashboard = () => useContext(DashboardContext);

/** 사용자 영역 레이아웃: 대시보드 데이터 1회 조회 + 변경 알림 구독 */
export function UserLayout() {
  const { status, user } = useAuth();
  const mustChange = !!user?.mustChangePassword;
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const loading = useRef(false);

  const reload = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const d = await api<DashboardData>('dashboard');
      setData(d);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PASSWORD_CHANGE_REQUIRED') return;
      setError(errorText(e));
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    // 초기 비밀번호 변경 전에는 조회하지 않고, 변경 완료 즉시 다시 불러온다
    if (status !== 'authenticated' || mustChange) return;
    void reload();
    return subscribeRevision(() => void reload());
  }, [status, mustChange, reload]);

  const markSeen = () => {
    api('updatePrefs', { markNotificationsSeen: true }).catch(() => undefined);
    setData((d) => (d ? { ...d, notifications: d.notifications.map((n) => ({ ...n, unread: false })) } : d));
  };

  return (
    <DashboardContext.Provider value={{ data, error, reload, setData }}>
      <AppHeader notifications={data?.notifications} onNotificationsSeen={markSeen} />
      <main className="container" id="main">
        <Outlet />
      </main>
    </DashboardContext.Provider>
  );
}

export function DashboardPage() {
  const { data, error, reload, setData } = useDashboard();
  const toast = useToast();
  const nav = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  const onLaunch = async (s: ServiceCard) => {
    if (!s.canLaunch) return;
    setBusyId(s.serviceId);
    try {
      const r = await launchService(s.serviceId, s.openMode);
      if (r.mode === 'embed') {
        sessionStorage.setItem('profcys.embed.' + s.serviceId, JSON.stringify(r.result));
        nav(`/service/${encodeURIComponent(s.serviceId)}`);
      } else {
        toast(`${s.serviceName}을(를) ${r.mode === 'opened' ? '새 탭에서' : ''} 실행했습니다.`, 'ok');
      }
      void reload();
    } catch (e) {
      toast(errorText(e), 'error');
      void reload();
    } finally {
      setBusyId(null);
    }
  };

  const onFav = async (s: ServiceCard) => {
    const next = !s.favorite;
    setData((d) => (d ? { ...d, services: d.services.map((x) => (x.serviceId === s.serviceId ? { ...x, favorite: next } : x)) } : d));
    try {
      await api('toggleFavorite', { serviceId: s.serviceId, favorite: next });
    } catch (e) {
      toast(errorText(e), 'error');
      void reload();
    }
  };

  if (!data && error) return <Alert kind="error">{error} <button className="btn small secondary" onClick={() => void reload()}>다시 시도</button></Alert>;
  if (!data) return <Loading text="업무 서비스를 불러오는 중입니다…" />;
  return (
    <>
      {error && <div style={{ marginBottom: 12 }}><Alert kind="warn">{error}</Alert></div>}
      <DashboardView data={data} onLaunch={onLaunch} onToggleFavorite={onFav} busyId={busyId} supportContact={data.platform.supportContact} />
      <InstallHint />
    </>
  );
}

/** 모바일 홈 화면 바로가기 추가 안내 (27장) */
function InstallHint() {
  const [prompt, setPrompt] = useState<{ prompt: () => void } | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('profcys.installHint') === 'hide'; } catch { return false; } });
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setPrompt(e as unknown as { prompt: () => void }); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  if (hidden || standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const hide = () => { setHidden(true); try { localStorage.setItem('profcys.installHint', 'hide'); } catch { /* noop */ } };
  return (
    <div className="alert info" style={{ marginTop: 24 }}>
      <Icon name="install_mobile" />
      <div className="grow small">
        {prompt ? 'PROFCYS 를 앱처럼 설치하여 홈 화면에서 바로 실행할 수 있습니다.' : ios ? 'Safari 공유 버튼 → "홈 화면에 추가"를 눌러 바로가기를 만들 수 있습니다.' : '브라우저 메뉴의 "홈 화면에 추가" 또는 "앱 설치"로 바로가기를 만들 수 있습니다.'}
      </div>
      {prompt && <button className="btn small" onClick={() => prompt.prompt()}>설치</button>}
      <button className="btn small ghost" onClick={hide}>닫기</button>
    </div>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  const { data } = useDashboard();
  if (!user) return null;
  const rows: [string, React.ReactNode][] = [
    ['이름', user.displayName],
    ['아이디', user.username],
    ['역할', ROLE_LABEL[user.role]],
    ['소속 기관', user.organization || '-'],
    ['부서 / 직책', [user.department, user.position].filter(Boolean).join(' / ') || '-'],
    ['이메일', user.email || '-'],
    ['연락처', user.phone || '-'],
    ['계정 사용 기간', `${fmtDateStr(user.validFrom) === '-' ? '제한 없음' : fmtDateStr(user.validFrom)} ~ ${fmtDateStr(user.validUntil) === '-' ? '제한 없음' : fmtDateStr(user.validUntil)}`],
    ['최근 로그인', fmtDateTime(user.lastLoginAt)],
    ['비밀번호 변경일', fmtDateTime(user.passwordChangedAt)],
  ];
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head"><div><h1>계정 정보</h1><p>개인정보는 업무에 필요한 범위에서만 보관됩니다. 정보 변경은 관리자에게 요청하세요.</p></div></div>
      <div className="panel">
        <table className="table"><tbody>{rows.map(([k, v]) => <tr key={k}><th style={{ width: 180 }}>{k}</th><td>{v}</td></tr>)}</tbody></table>
      </div>
      <div className="panel">
        <div className="panel-title"><h3>이용 가능한 서비스</h3><Badge>{data?.counts.available ?? '-'}개</Badge></div>
        <div className="row">
          {(data?.services || []).filter((s) => s.state !== 'LOCKED').map((s) => <Badge key={s.serviceId} icon={s.icon}>{s.serviceName}</Badge>)}
          {data && data.services.length === 0 && <span className="muted small">이용 가능한 서비스가 없습니다.</span>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <Link className="btn" to="/account/password"><Icon name="password" /> 비밀번호 변경</Link>
        <Link className="btn secondary" to="/">대시보드로</Link>
      </div>
    </div>
  );
}

export function ChangePasswordPage() {
  const { user, changePassword, platform, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const min = platform?.passwordMinLength || 12;
  if (!user) return null;
  const problems = passwordProblems(pw, min, user.username);
  const forced = user.mustChangePassword;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length || pw !== pw2) return;
    setBusy(true);
    setError('');
    try {
      await changePassword(cur, pw);
      toast('비밀번호를 변경했습니다. 다른 기기의 로그인은 모두 종료되었습니다.', 'ok');
      nav('/', { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setCur('');
    }
  };
  return (
    <div style={{ maxWidth: 520, margin: forced ? '24px auto' : undefined }}>
      <div className="page-head"><div><h1>{forced ? '초기 비밀번호 변경' : '비밀번호 변경'}</h1>
        <p>{forced ? '보안을 위해 관리자가 발급한 초기 비밀번호를 새 비밀번호로 변경해야 서비스를 이용할 수 있습니다.' : '변경하면 다른 기기의 로그인 세션은 모두 종료됩니다.'}</p></div></div>
      <form className="panel stack" onSubmit={submit}>
        <PasswordField label={forced ? '초기(현재) 비밀번호' : '현재 비밀번호'} value={cur} onChange={setCur} autoComplete="current-password" required />
        <PasswordField label="새 비밀번호" value={pw} onChange={setPw} autoComplete="new-password" required />
        <PasswordChecklist password={pw} minLength={min} username={user.username} />
        <PasswordField label="새 비밀번호 확인" value={pw2} onChange={setPw2} autoComplete="new-password" required error={pw2 && pw !== pw2 ? '비밀번호가 일치하지 않습니다.' : undefined} />
        {error && <Alert kind="error">{error}</Alert>}
        <div className="row">
          <button className="btn navy" type="submit" disabled={busy || !cur || problems.length > 0 || pw !== pw2}>{busy && <Spinner small />} 비밀번호 변경</button>
          {forced ? <button type="button" className="btn ghost" onClick={async () => { await logout(); nav('/login'); }}>로그아웃</button> : <Link to="/account" className="btn ghost">취소</Link>}
        </div>
      </form>
    </div>
  );
}

/** 플랫폼 내부 임베딩 실행 (보안 검증이 완료되고 관리자가 임베딩을 허용한 서비스만) */
export function EmbedPage() {
  const { serviceId = '' } = useParams();
  const [r] = useState<LaunchResult | null>(() => {
    try {
      const raw = sessionStorage.getItem('profcys.embed.' + serviceId);
      sessionStorage.removeItem('profcys.embed.' + serviceId);
      return raw ? (JSON.parse(raw) as LaunchResult) : null;
    } catch { return null; }
  });
  if (!r) return <Alert kind="info">포털 대시보드에서 서비스를 다시 실행하세요. <Link to="/">대시보드로</Link></Alert>;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{r.serviceName}</h2>
        <div className="row">
          <a className="btn small secondary" href={r.url} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" /> 새 탭에서 열기</a>
          <Link className="btn small" to="/"><Icon name="home" /> 포털 홈</Link>
        </div>
      </div>
      <iframe className="embed-frame" title={r.serviceName} src={r.url} sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" referrerPolicy="no-referrer" />
    </div>
  );
}

export function HelpPage() {
  return (
    <div className="panel" style={{ maxWidth: 860 }}>
      <h1>이용 안내</h1>
      <ol className="stack" style={{ paddingLeft: 20 }}>
        <li><strong>로그인</strong> — 관리자가 발급한 아이디와 비밀번호로 로그인합니다. 처음 로그인하면 비밀번호를 변경해야 합니다.</li>
        <li><strong>서비스 실행</strong> — 대시보드의 서비스 카드에서 [접속]을 누르면 권한 확인 후 새 탭에서 업무 서비스가 열립니다. 포털 탭은 그대로 남아 있어 언제든 돌아올 수 있습니다.</li>
        <li><strong>검색·필터</strong> — 상단 검색창과 분류 버튼으로 원하는 서비스를 빠르게 찾을 수 있습니다. ★ 버튼으로 즐겨찾기를 추가하세요.</li>
        <li><strong>자동 로그아웃</strong> — 일정 시간(기본 60분) 사용하지 않으면 자동으로 로그아웃되며, 5분 전에 안내합니다.</li>
        <li><strong>상태 표시</strong> — 이용 가능 / 점검 중 / 접근 제한 / 이용 중지로 표시됩니다. 접근 권한이 필요하면 관리자에게 문의하세요.</li>
        <li><strong>홈 화면 추가</strong> — 스마트폰 브라우저 메뉴의 "홈 화면에 추가"로 앱처럼 사용할 수 있습니다.</li>
      </ol>
      <Link to="/" className="btn secondary">대시보드로</Link>
    </div>
  );
}
