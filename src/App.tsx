import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, isAdmin, useAuth } from './auth/AuthContext';
import { Icon, Loading, Modal, ToastProvider } from './components/ui';
import { ErrorScreen } from './components/ErrorScreen';
import LoginPage from './pages/LoginPage';
import { RecoverPage, SetupPage } from './pages/SetupPages';
import { AccountPage, ChangePasswordPage, DashboardPage, EmbedPage, HelpPage, UserLayout } from './pages/UserPages';

// 관리자 화면은 별도 청크로 분리 (일반 사용자는 내려받지 않음 — 단, 접근 제어는 서버에서 수행)
const AdminApp = lazy(() => import('./admin/AdminApp'));

/** 로그인 필요 + 초기 비밀번호 변경 강제 (10장 검증 우선순위 5단계의 화면 처리. 실제 차단은 서버가 수행) */
function RequireAuth() {
  const { status, user } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Loading text="인증 상태를 확인하는 중입니다…" />;
  if (status !== 'authenticated' || !user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.mustChangePassword && loc.pathname !== '/account/password') return <Navigate to="/account/password" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { user } = useAuth();
  if (!isAdmin(user)) return <ErrorScreen code="403" title="접근 권한이 없습니다" message="관리자 전용 화면입니다. 권한이 필요하면 최고관리자에게 문의하세요." />;
  return <Outlet />;
}

export { ErrorScreen };

function IdleWarning() {
  const { idleWarning, extendSession, logout } = useAuth();
  if (idleWarning == null) return null;
  const m = Math.floor(idleWarning / 60);
  const s = idleWarning % 60;
  return (
    <Modal
      title="자동 로그아웃 예정"
      onClose={extendSession}
      footer={
        <>
          <button className="btn secondary" onClick={() => void logout('로그아웃되었습니다.')}>지금 로그아웃</button>
          <button className="btn" onClick={extendSession}>계속 사용</button>
        </>
      }
    >
      <p role="timer" aria-live="polite">장시간 사용하지 않아 <strong>{m}분 {String(s).padStart(2, '0')}초</strong> 후 자동으로 로그아웃됩니다.</p>
    </Modal>
  );
}

function OfflineBar() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online ? null : <div className="offline-bar" role="alert"><Icon name="wifi_off" /> 네트워크 연결이 끊어졌습니다. 연결되면 자동으로 다시 이용할 수 있습니다.</div>;
}

function UpdateNotice() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const h = () => setWaiting(true);
    window.addEventListener('profcys:sw-update', h);
    return () => window.removeEventListener('profcys:sw-update', h);
  }, []);
  if (!waiting) return null;
  return (
    <div className="toasts"><div className="toast"><Icon name="system_update" /><span className="grow">새 버전이 있습니다.</span><button className="btn small secondary" onClick={() => window.location.reload()}>새로고침</button></div></div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <OfflineBar />
          <IdleWarning />
          <UpdateNotice />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/recover" element={<RecoverPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<UserLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="account" element={<AccountPage />} />
                <Route path="account/password" element={<ChangePasswordPage />} />
                <Route path="service/:serviceId" element={<EmbedPage />} />
                <Route path="help" element={<HelpPage />} />
              </Route>
              <Route element={<RequireAdmin />}>
                <Route path="admin/*" element={<Suspense fallback={<Loading />}><AdminApp /></Suspense>} />
              </Route>
            </Route>
            <Route path="*" element={<ErrorScreen code="404" title="페이지를 찾을 수 없습니다" message="주소가 올바른지 확인하세요." />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
