/** 관리자 전용 대시보드 (11장) — 메뉴 항목·권한 항목·통계 항목은 모두 DB 의 서비스 목록으로부터 동적으로 구성된다 */
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { isSuperAdmin, useAuth } from '../auth/AuthContext';
import { AppHeader } from '../layouts/AppHeader';
import { api, errorText } from '../services/api';
import { subscribeRevision } from '../services/revision';
import { Alert, Badge, Empty, Icon, Loading } from '../components/ui';
import { fmtDateTime, ROLE_LABEL, SERVICE_STATUS_LABEL, INTEGRATION_LABEL } from '../utils/format';
import type { AdminService, Category, User } from '../types';
import { UsersPage, PermissionsPage } from './Users';
import { ServicesPage } from './Services';
import { AnnouncementsPage, BackupPage, CategoriesPage, QrPage, SettingsPage, UiSettingsPage } from './Content';
import { AccessLogsPage, AdminLogsPage, StatsPage } from './Logs';
import { ErrorScreen } from '../components/ErrorScreen';

import { AdminContext as Ctx, useAdmin } from './context';

export default function AdminApp() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [services, setServices] = useState<AdminService[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [rev, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const reloadServices = useCallback(async () => {
    const r = await api<{ services: AdminService[]; categories: Category[]; allowedServiceDomains: string[] }>('admin.services.list');
    setServices(r.services);
    setCategories(r.categories);
    setAllowedDomains(r.allowedServiceDomains);
  }, []);
  useEffect(() => {
    void reloadServices().catch(() => undefined);
    return subscribeRevision((r) => { setRev(r); void reloadServices().catch(() => undefined); });
  }, [reloadServices]);

  const sup = isSuperAdmin(user);
  const items: [string, string, string, boolean][] = [
    ['', 'space_dashboard', '관리자 홈', true],
    ['users', 'group', '사용자 계정 관리', true],
    ['users/new', 'person_add', '신규 사용자 등록', true],
    ['permissions', 'rule', '서비스 접근 권한 관리', true],
    ['services', 'apps', '업무 서비스 관리', true],
    ['categories', 'category', '서비스 카테고리', sup],
    ['ui', 'dashboard_customize', '화면 구성 관리', sup],
    ['announcements', 'campaign', '공지사항 관리', true],
    ['logs/access', 'history', '접속 기록 관리', true],
    ['logs/admin', 'manage_history', '관리자 작업 이력', sup],
    ['stats', 'monitoring', '운영 통계', true],
    ['settings', 'settings', '시스템 설정', sup],
    ['backup', 'backup', '데이터 백업 및 내보내기', sup],
    ['qr', 'qr_code_2', '접속 QR코드', true],
  ];
  return (
    <Ctx.Provider value={{ services, categories, allowedDomains, reloadServices, rev }}>
      <AppHeader onMenuToggle={() => setOpen((o) => !o)} />
      <div className="admin-shell">
        <nav className={`admin-nav${open ? ' open' : ''}`} aria-label="관리자 메뉴" onClick={() => setOpen(false)}>
          <div className="group">관리</div>
          {items.filter((i) => i[3]).map(([to, icon, label]) => (
            <NavLink key={to} to={`/admin${to ? '/' + to : ''}`} end={to === '' || to === 'users'}><Icon name={icon} /> {label}</NavLink>
          ))}
          <div className="group">이동</div>
          <NavLink to="/" end><Icon name="dashboard" /> 사용자 대시보드 전환</NavLink>
          <button type="button" onClick={async () => { await logout('로그아웃되었습니다.'); nav('/login'); }}><Icon name="logout" /> 로그아웃</button>
        </nav>
        <main className="admin-main" id="main">
          <Routes>
            <Route index element={<AdminHome />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/new" element={<UsersPage createOnOpen />} />
            <Route path="permissions" element={<PermissionsPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="categories" element={sup ? <CategoriesPage /> : <Forbidden />} />
            <Route path="ui" element={sup ? <UiSettingsPage /> : <Forbidden />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="logs/access" element={<AccessLogsPage />} />
            <Route path="logs/admin" element={sup ? <AdminLogsPage /> : <Forbidden />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="settings" element={sup ? <SettingsPage /> : <Forbidden />} />
            <Route path="backup" element={sup ? <BackupPage /> : <Forbidden />} />
            <Route path="qr" element={<QrPage />} />
            <Route path="*" element={<ErrorScreen code="404" title="페이지를 찾을 수 없습니다" message="관리자 메뉴에서 다시 선택하세요." />} />
          </Routes>
        </main>
      </div>
    </Ctx.Provider>
  );
}

function Forbidden() {
  return <Alert kind="error">최고관리자만 이용할 수 있는 메뉴입니다.</Alert>;
}

interface Overview {
  metrics: Record<string, number>;
  recentUsers: User[];
  recentLogins: User[];
  recentAdminLogs: { action: string; adminUsername: string; changeSummary: string; timestamp: number; targetUsername?: string; targetServiceId?: string }[];
  attention: { serviceId: string; serviceName: string; effectiveStatus: string; securityVerified: boolean; integrationStatus: string; isInitialService: boolean }[];
  serverTime: number;
}

function AdminHome() {
  const { rev } = useAdmin();
  const [d, setD] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Overview>('admin.overview').then(setD).catch((e) => setError(errorText(e)));
  }, [rev]);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!d) return <Loading />;
  const m = d.metrics;
  const cards: [string, string, number][] = [
    ['group', '전체 등록 사용자', m.totalUsers], ['how_to_reg', '활성 사용자', m.activeUsers], ['person_off', '비활성 사용자', m.inactiveUsers],
    ['login', '금일 로그인 사용자', m.todayLoginUsers], ['apps', '등록 업무 서비스', m.totalServices], ['check_circle', '활성 업무 서비스', m.activeServices],
    ['open_in_new', '금일 서비스 접속', m.todayServiceLaunches], ['gpp_bad', '금일 로그인 실패', m.todayLoginFailures],
  ];
  return (
    <>
      <div className="page-head"><div><h1>관리자 홈</h1><p>실제 데이터베이스 기준 수치입니다 · {fmtDateTime(d.serverTime)} 기준</p></div></div>
      <div className="metrics">
        {cards.map(([icon, label, v]) => (
          <div key={label} className="metric"><div className="label"><Icon name={icon} /> {label}</div><div className="value">{(v ?? 0).toLocaleString()}</div></div>
        ))}
      </div>
      <div className="panel">
        <div className="panel-title"><h3><Icon name="report" /> 서비스 점검·검토 필요 현황</h3><NavLink to="/admin/services" className="btn small secondary">서비스 관리</NavLink></div>
        {d.attention.length === 0 ? <Empty icon="verified" title="점검 또는 검토가 필요한 서비스가 없습니다." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>서비스</th><th>상태</th><th>연동 상태</th><th>안내</th></tr></thead><tbody>
            {d.attention.map((a) => (
              <tr key={a.serviceId}>
                <td>{a.serviceName}<div className="small muted mono">{a.serviceId}</div></td>
                <td><Badge kind={a.effectiveStatus === 'MAINTENANCE' ? 'warn' : a.effectiveStatus === 'ACTIVE' ? 'ok' : undefined}>{SERVICE_STATUS_LABEL[a.effectiveStatus]}</Badge></td>
                <td className="small">{INTEGRATION_LABEL[a.integrationStatus] || a.integrationStatus}</td>
                <td className="small">{a.isInitialService && a.effectiveStatus === 'DRAFT' ? '초기 서비스: 보안·공개 검증 후 공개 승인 필요' : a.effectiveStatus === 'MAINTENANCE' ? '점검 중' : a.effectiveStatus === 'EXPIRED' ? '공개 종료일 경과' : '공개 중이나 보안 검증 미완료'}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3>최근 등록 사용자</h3>
          <UserMiniList users={d.recentUsers} field="createdAt" />
        </div>
        <div className="panel">
          <h3>최근 로그인 사용자</h3>
          <UserMiniList users={d.recentLogins} field="lastLoginAt" />
        </div>
      </div>
      {d.recentAdminLogs.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title"><h3>최근 관리자 작업 이력</h3><NavLink to="/admin/logs/admin" className="btn small secondary">전체 보기</NavLink></div>
          <div className="table-wrap"><table className="table"><tbody>
            {d.recentAdminLogs.map((l, i) => (
              <tr key={i}><td className="nowrap small">{fmtDateTime(l.timestamp)}</td><td className="small">{l.adminUsername}</td><td><Badge>{l.action}</Badge></td><td className="small">{l.targetUsername || l.targetServiceId} {l.changeSummary}</td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}
    </>
  );
}

function UserMiniList({ users, field }: { users: User[]; field: 'createdAt' | 'lastLoginAt' }) {
  if (!users.length) return <Empty icon="person" title="기록이 없습니다." />;
  return (
    <div className="table-wrap"><table className="table"><tbody>
      {users.map((u) => (
        <tr key={u.uid}><td>{u.displayName}<div className="small muted">{u.username}</div></td><td className="small">{ROLE_LABEL[u.role]}</td><td className="small nowrap">{fmtDateTime(u[field])}</td></tr>
      ))}
    </tbody></table></div>
  );
}
