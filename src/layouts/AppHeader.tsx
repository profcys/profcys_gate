import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, useAuth } from '../auth/AuthContext';
import { Icon, Logo } from '../components/ui';
import { useNow } from '../hooks/useElementWidth';
import { fmtDateTime, relativeTime, ROLE_LABEL } from '../utils/format';
import type { NotificationItem } from '../types';

function useOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onOut]);
  return ref;
}

export function AppHeader({ notifications, onNotificationsSeen, onMenuToggle }: { notifications?: NotificationItem[]; onNotificationsSeen?: () => void; onMenuToggle?: () => void }) {
  const { user, logout } = useAuth();
  const now = useNow(15_000);
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState<'user' | 'noti' | null>(null);
  const close = () => setMenu(null);
  const ref = useOutside(close);
  const unread = (notifications || []).filter((n) => n.unread).length;
  const inAdmin = loc.pathname.startsWith('/admin');
  if (!user) return null;
  return (
    <header className="app-header">
      {onMenuToggle && (
        <button type="button" className="icon-btn admin-mobile-nav" onClick={onMenuToggle} aria-label="관리자 메뉴 열기"><Icon name="menu" /></button>
      )}
      <Logo to="/" />
      <div className="grow" />
      <span className="clock hide-md" aria-label="현재 날짜와 시간">{fmtDateTime(now)}</span>
      <div className="row" ref={ref} style={{ gap: 4, position: 'relative', flexWrap: 'nowrap' }}>
        {isAdmin(user) && (
          <Link className="icon-btn" to={inAdmin ? '/' : '/admin'} aria-label={inAdmin ? '사용자 대시보드로 전환' : '관리자 대시보드'} title={inAdmin ? '사용자 대시보드' : '관리자 대시보드'} style={{ color: '#fff' }}>
            <Icon name={inAdmin ? 'dashboard' : 'admin_panel_settings'} />
          </Link>
        )}
        {notifications && (
          <div className="rel">
            <button type="button" className="icon-btn" aria-label={`알림 ${unread}건`} aria-expanded={menu === 'noti'} onClick={() => { setMenu(menu === 'noti' ? null : 'noti'); if (unread && onNotificationsSeen) onNotificationsSeen(); }}>
              <Icon name="notifications" />
              {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
            </button>
            {menu === 'noti' && (
              <div className="menu wide" role="menu" aria-label="알림">
                {notifications.length === 0 && <div className="small muted" style={{ padding: 10 }}>새 알림이 없습니다.</div>}
                {notifications.map((n) => (
                  <div key={n.type + n.id} style={{ padding: '8px 10px', borderRadius: 6, background: n.unread ? '#f4f8ff' : undefined }}>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Icon name={n.type === 'NEW_SERVICE' ? 'fiber_new' : n.priority === 'HIGH' ? 'priority_high' : 'campaign'} />
                      <span className="grow small" style={{ fontWeight: n.unread ? 600 : 400 }}>{n.title}</span>
                    </div>
                    <div className="small muted" style={{ marginLeft: 30 }}>{relativeTime(n.at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="rel">
          <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={menu === 'user'} onClick={() => setMenu(menu === 'user' ? null : 'user')}>
            <span className="avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span>
            <span className="user-meta hide-sm">
              <span>{user.displayName}</span>
              <small>{ROLE_LABEL[user.role]}</small>
            </span>
            <Icon name="expand_more" />
          </button>
          {menu === 'user' && (
            <div className="menu" role="menu">
              <div style={{ padding: '8px 10px' }}>
                <strong>{user.displayName}</strong>
                <div className="small muted">{user.username} · {ROLE_LABEL[user.role]}</div>
              </div>
              <hr />
              <Link to="/" role="menuitem" onClick={close}><Icon name="home" /> 통합 포털 홈</Link>
              {isAdmin(user) && <Link to="/admin" role="menuitem" onClick={close}><Icon name="admin_panel_settings" /> 관리자 대시보드</Link>}
              <Link to="/account" role="menuitem" onClick={close}><Icon name="manage_accounts" /> 계정 설정</Link>
              <Link to="/account/password" role="menuitem" onClick={close}><Icon name="password" /> 비밀번호 변경</Link>
              <Link to="/help" role="menuitem" onClick={close}><Icon name="help" /> 이용 안내</Link>
              <hr />
              <button type="button" role="menuitem" onClick={async () => { close(); await logout('로그아웃되었습니다.'); nav('/login'); }}><Icon name="logout" /> 로그아웃</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
