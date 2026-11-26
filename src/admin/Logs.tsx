/** 접속 기록 (25장) · 관리자 작업 이력 (26장) · 운영 통계 (11·25장) — 모든 수치는 실제 DB 기준 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../services/api';
import { Alert, Badge, Empty, Icon, Loading, Spinner } from '../components/ui';
import { ACCESS_ACTION_LABEL, fmtDateTime, todayKey } from '../utils/format';
import { downloadText, toCsv } from '../utils/csv';
import { useAdmin } from './context';

interface AccessLog { logId: string; userId: string; username: string; serviceId: string; action: string; result: string; errorCode: string; detail: string; timestamp: number }
interface AdminLog { logId: string; adminId: string; adminUsername: string; action: string; targetUserId?: string; targetUsername?: string; targetServiceId?: string; changeSummary: string; result?: string; timestamp: number }

function useLogs<T extends { timestamp: number }>(action: string, filters: Record<string, string>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fetchPage = useCallback(async (before?: number) => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const r = await api<{ items: T[]; nextBefore: number | null }>(action, { ...clean, before, limit: 100 });
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items));
      setNext(r.nextBefore);
      setError('');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }, [action, filters]);
  useEffect(() => { void fetchPage(); }, [fetchPage]);
  return { items, next, busy, error, more: () => next && fetchPage(next), reload: () => fetchPage() };
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <>
      <input className="input" style={{ width: 'auto' }} type="date" aria-label="시작일" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="muted">~</span>
      <input className="input" style={{ width: 'auto' }} type="date" aria-label="종료일" value={to} onChange={(e) => onChange(from, e.target.value)} />
    </>
  );
}

export function AccessLogsPage() {
  const { services } = useAdmin();
  const [f, setF] = useState({ from: todayKey(-6), to: todayKey(), action: '', serviceId: '', result: '', userId: '' });
  const filters = useMemo(() => f, [f]);
  const { items, next, busy, error, more } = useLogs<AccessLog>('admin.logs.access', filters);
  const svcName = useMemo(() => Object.fromEntries(services.map((s) => [s.serviceId, s.serviceName])), [services]);
  const exportCsv = () => items && downloadText(`profcys-access-logs-${f.from}_${f.to}.csv`, toCsv(
    ['시각', '아이디', '서비스', '작업', '결과', '오류 코드', '상세'],
    items.map((l) => [fmtDateTime(l.timestamp, true), l.username, l.serviceId ? svcName[l.serviceId] || l.serviceId : '', ACCESS_ACTION_LABEL[l.action] || l.action, l.result, l.errorCode, l.detail]),
  ));
  return (
    <>
      <div className="page-head">
        <div><h1>접속 기록 관리</h1><p>로그인·로그아웃·서비스 실행·인증·권한 거부 기록입니다. 비밀번호·인증 코드·세션 토큰은 기록하지 않습니다.</p></div>
        <button className="btn secondary" disabled={!items?.length} onClick={exportCsv}><Icon name="download" /> CSV 내보내기 ({items?.length || 0}건)</button>
      </div>
      <div className="panel">
        <div className="filters">
          <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
          <select className="input" style={{ width: 'auto' }} aria-label="작업 유형" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">모든 작업</option>{Object.entries(ACCESS_ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} aria-label="서비스" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}><option value="">모든 서비스</option>{services.map((s) => <option key={s.serviceId} value={s.serviceId}>{s.serviceName}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} aria-label="결과" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="">모든 결과</option><option value="SUCCESS">성공</option><option value="FAILURE">실패</option></select>
          {f.userId && <button className="btn small secondary" onClick={() => setF({ ...f, userId: '' })}>사용자 필터 해제 ✕</button>}
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        {!items ? <Loading /> : items.length === 0 ? <Empty icon="history" title="조건에 맞는 기록이 없습니다." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>시각</th><th>사용자</th><th>서비스</th><th>작업</th><th>결과</th><th>상세</th></tr></thead><tbody>
            {items.map((l) => (
              <tr key={l.logId}>
                <td className="small nowrap">{fmtDateTime(l.timestamp, true)}</td>
                <td className="small">{l.userId ? <button className="link" title="이 사용자 기록만 보기" onClick={() => setF({ ...f, userId: l.userId })}>{l.username}</button> : l.username || '-'}</td>
                <td className="small">{l.serviceId ? svcName[l.serviceId] || l.serviceId : '-'}</td>
                <td className="small">{ACCESS_ACTION_LABEL[l.action] || l.action}</td>
                <td><Badge kind={l.result === 'SUCCESS' ? 'ok' : 'err'}>{l.result === 'SUCCESS' ? '성공' : '실패'}</Badge>{l.errorCode && <div className="small muted mono">{l.errorCode}</div>}</td>
                <td className="small">{l.detail}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {next && <div className="center" style={{ marginTop: 12 }}><button className="btn secondary" disabled={busy} onClick={() => void more()}>{busy && <Spinner small />} 더 보기</button></div>}
      </div>
    </>
  );
}

export function AdminLogsPage() {
  const [f, setF] = useState({ from: todayKey(-29), to: todayKey(), action: '', adminId: '' });
  const filters = useMemo(() => f, [f]);
  const { items, next, busy, error, more } = useLogs<AdminLog>('admin.logs.admin', filters);
  const actions = useMemo(() => Array.from(new Set((items || []).map((l) => l.action))).sort(), [items]);
  const exportCsv = () => items && downloadText(`profcys-admin-logs-${f.from}_${f.to}.csv`, toCsv(
    ['시각', '관리자', '작업', '대상 사용자', '대상 서비스', '변경 요약'],
    items.map((l) => [fmtDateTime(l.timestamp, true), l.adminUsername, l.action, l.targetUsername || '', l.targetServiceId || '', l.changeSummary]),
  ));
  return (
    <>
      <div className="page-head">
        <div><h1>관리자 작업 이력</h1><p>계정·권한·서비스·설정 변경 등 모든 관리자 작업이 기록됩니다. 비밀번호와 키 원문은 기록하지 않습니다.</p></div>
        <button className="btn secondary" disabled={!items?.length} onClick={exportCsv}><Icon name="download" /> CSV 내보내기</button>
      </div>
      <div className="panel">
        <div className="filters">
          <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
          <select className="input" style={{ width: 'auto' }} aria-label="작업 유형" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">모든 작업</option>{Array.from(new Set([...actions, f.action].filter(Boolean))).map((a) => <option key={a} value={a}>{a}</option>)}</select>
          {f.adminId && <button className="btn small secondary" onClick={() => setF({ ...f, adminId: '' })}>관리자 필터 해제 ✕</button>}
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        {!items ? <Loading /> : items.length === 0 ? <Empty icon="manage_history" title="기록이 없습니다." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>시각</th><th>관리자</th><th>작업</th><th>대상</th><th>변경 요약</th></tr></thead><tbody>
            {items.map((l) => (
              <tr key={l.logId}>
                <td className="small nowrap">{fmtDateTime(l.timestamp, true)}</td>
                <td className="small"><button className="link" onClick={() => setF({ ...f, adminId: l.adminId })}>{l.adminUsername}</button></td>
                <td><Badge>{l.action}</Badge></td>
                <td className="small">{[l.targetUsername, l.targetServiceId].filter(Boolean).join(' · ') || '-'}</td>
                <td className="small" style={{ wordBreak: 'break-word' }}>{l.changeSummary}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {next && <div className="center" style={{ marginTop: 12 }}><button className="btn secondary" disabled={busy} onClick={() => void more()}>{busy && <Spinner small />} 더 보기</button></div>}
      </div>
    </>
  );
}

interface Stats {
  from: string; to: string;
  daily: { date: string; loginUsers: number; logins: number; failures: number; denied: number; launches: number }[];
  weekly: { week: string; loginUsers: number }[];
  monthly: { month: string; loginUsers: number }[];
  services: { serviceId: string; serviceName: string; primaryColor: string; share: number; serviceLaunch: number; serviceAuthSuccess: number; serviceAuthFailure: number; serviceDenied: number }[];
  totals: { loginSuccess: number; loginFailure: number; accessDenied: number; serviceLaunchTotal: number; passwordChange: number };
  users: { total: number; active: number; inactive: number; newInPeriod: number };
  recentLogins: { uid: string; username: string; displayName: string; organization: string; lastLoginAt: number }[];
}

/** 일별 막대 그래프 (SVG). 값은 표로도 제공한다. */
function DailyChart({ data, field, label, color }: { data: Stats['daily']; field: 'loginUsers' | 'launches' | 'failures'; label: string; color: string }) {
  const W = 720;
  const H = 180;
  const pad = { l: 32, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...data.map((d) => d[field]));
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} 일별 추이, 최대 ${max}`}>
        {ticks.map((t) => {
          const y = H - pad.b - ((H - pad.t - pad.b) * t) / max;
          return <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#e5e7eb" /><text x={pad.l - 6} y={y + 4} fontSize="10" textAnchor="end" fill="#64748b">{t}</text></g>;
        })}
        {data.map((d, i) => {
          const h = ((H - pad.t - pad.b) * d[field]) / max;
          return (
            <g key={d.date}>
              <rect x={pad.l + i * bw + bw * 0.15} y={H - pad.b - h} width={Math.max(1, bw * 0.7)} height={h} fill={color} rx="2"><title>{`${d.date}: ${d[field]}`}</title></rect>
              {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && <text x={pad.l + i * bw + bw / 2} y={H - 8} fontSize="10" textAnchor="middle" fill="#64748b">{d.date.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted">{label}</figcaption>
    </figure>
  );
}

export function StatsPage() {
  const { rev } = useAdmin();
  const [range, setRange] = useState({ from: todayKey(-29), to: todayKey() });
  const [d, setD] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setD(null);
    api<Stats>('admin.stats', range).then(setD).catch((e) => setError(errorText(e)));
  }, [range, rev]);
  const exportCsv = () => {
    if (!d) return;
    downloadText(`profcys-stats-${d.from}_${d.to}.csv`, toCsv(['날짜', '로그인 사용자 수', '로그인 성공', '로그인 실패', '권한 거부', '서비스 실행'], d.daily.map((x) => [x.date, x.loginUsers, x.logins, x.failures, x.denied, x.launches])) +
      '\r\n\r\n' + toCsv(['서비스 ID', '서비스', '실행 요청', '인증 성공', '인증 실패', '접근 거부', '이용 비율(%)'], d.services.map((s) => [s.serviceId, s.serviceName, s.serviceLaunch, s.serviceAuthSuccess, s.serviceAuthFailure, s.serviceDenied, (s.share * 100).toFixed(1)])));
  };
  return (
    <>
      <div className="page-head">
        <div><h1>운영 통계</h1><p>일별 집계 문서(statsDaily) 기준 실제 수치입니다. 데이터가 없는 날은 0 으로 표시합니다.</p></div>
        <div className="row">
          <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
          <button className="btn secondary" disabled={!d} onClick={exportCsv}><Icon name="download" /> CSV</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!d ? <Loading /> : (
        <>
          <div className="metrics">
            {([
              ['group', '전체 사용자', d.users.total], ['how_to_reg', '이용 가능 계정', d.users.active], ['person_off', '비활성·만료 계정', d.users.inactive],
              ['person_add', '기간 내 신규 등록', d.users.newInPeriod], ['login', '로그인 성공', d.totals.loginSuccess], ['gpp_bad', '로그인 실패', d.totals.loginFailure],
              ['open_in_new', '서비스 실행 요청', d.totals.serviceLaunchTotal], ['block', '접근 권한 거부', d.totals.accessDenied],
            ] as [string, string, number][]).map(([icon, label, v]) => <div key={label} className="metric"><div className="label"><Icon name={icon} /> {label}</div><div className="value">{v.toLocaleString()}</div></div>)}
          </div>
          <div className="grid-2">
            <div className="panel"><h3>일별 로그인 사용자 수 (중복 제거)</h3><DailyChart data={d.daily} field="loginUsers" label="일별 고유 로그인 사용자" color="#2563EB" /></div>
            <div className="panel"><h3>일별 서비스 실행 요청</h3><DailyChart data={d.daily} field="launches" label="일별 서비스 실행 요청 수" color="#0F9D58" /></div>
          </div>
          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="panel">
              <h3>서비스별 이용 현황</h3>
              {d.services.length === 0 ? <Empty title="서비스가 없습니다." /> : d.services.map((s) => (
                <div key={s.serviceId} className="bar-row">
                  <span title={s.serviceId} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.serviceName}</span>
                  <div className="bar-track" role="img" aria-label={`${s.serviceName} ${s.serviceLaunch}회`}><div className="bar-fill" style={{ width: `${Math.max(s.share * 100, s.serviceLaunch ? 2 : 0)}%`, background: s.primaryColor || '#2563EB' }} /></div>
                  <span className="mono" style={{ textAlign: 'right' }}>{s.serviceLaunch}회</span>
                </div>
              ))}
              <div className="table-wrap" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>서비스</th><th>실행</th><th>인증 성공</th><th>인증 실패</th><th>거부</th><th>비율</th></tr></thead><tbody>
                {d.services.map((s) => <tr key={s.serviceId}><td className="small">{s.serviceName}</td><td>{s.serviceLaunch}</td><td>{s.serviceAuthSuccess}</td><td>{s.serviceAuthFailure}</td><td>{s.serviceDenied}</td><td>{(s.share * 100).toFixed(1)}%</td></tr>)}
              </tbody></table></div>
              <p className="small muted">“실행”은 포털에서의 접속 요청, “인증 성공”은 업무 시스템이 PROFCYS 인증 코드를 실제 검증한 횟수입니다(통합 인증 적용 서비스만 집계).</p>
            </div>
            <div className="stack">
              <div className="panel">
                <h3>주간·월간 로그인 사용자 (중복 제거)</h3>
                <div className="table-wrap"><table className="table"><tbody>
                  {d.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td className="mono">{m.loginUsers}명</td></tr>)}
                  {d.weekly.map((w) => <tr key={w.week}><td className="small muted">{w.week}</td><td className="mono small">{w.loginUsers}명</td></tr>)}
                </tbody></table></div>
              </div>
              <div className="panel">
                <h3>최근 로그인 사용자</h3>
                {d.recentLogins.length === 0 ? <Empty title="로그인 기록이 없습니다." /> : (
                  <div className="table-wrap"><table className="table"><tbody>
                    {d.recentLogins.map((u) => <tr key={u.uid}><td>{u.displayName}<div className="small muted">{u.username}{u.organization ? ' · ' + u.organization : ''}</div></td><td className="small nowrap">{fmtDateTime(u.lastLoginAt)}</td></tr>)}
                  </tbody></table></div>
                )}
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>일별 상세</h3>
            <div className="table-wrap" style={{ maxHeight: 360 }}><table className="table"><thead><tr><th>날짜</th><th>로그인 사용자</th><th>로그인 성공</th><th>로그인 실패</th><th>권한 거부</th><th>서비스 실행</th></tr></thead><tbody>
              {d.daily.slice().reverse().map((x) => <tr key={x.date}><td className="mono small">{x.date}</td><td>{x.loginUsers}</td><td>{x.logins}</td><td>{x.failures}</td><td>{x.denied}</td><td>{x.launches}</td></tr>)}
            </tbody></table></div>
          </div>
        </>
      )}
    </>
  );
}
