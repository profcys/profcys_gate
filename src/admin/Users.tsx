/** 사용자 계정 관리·신규 등록·비밀번호 초기화·일괄 관리 (12장) / 서비스별 접근 권한 관리 (13장) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSuperAdmin, useAuth } from '../auth/AuthContext';
import { api, ApiError, errorText } from '../services/api';
import { Alert, Badge, Check, ConfirmDialog, Empty, Icon, Loading, Modal, Pagination, PasswordField, SecretOnce, SelectField, Spinner, TextArea, TextField, useToast } from '../components/ui';
import { fmtDateStr, fmtDateTime, ROLE_LABEL, SERVICE_STATUS_LABEL, todayKey } from '../utils/format';
import { csvToObjects, downloadText, toCsv } from '../utils/csv';
import { useAdmin } from './context';
import type { AdminService, Role, User } from '../types';

interface ListResponse { items: User[]; total: number; page: number; pageSize: number; organizations: string[]; groups: string[] }

/** 서비스 권한 체크박스 — 서비스 목록은 DB 에서 받아 자동 생성 (신규 서비스 등록 시 자동으로 항목 추가) */
export function ServicePermissionChecklist({ value, onChange, actor, services, compact }: { value: string[]; onChange: (v: string[]) => void; actor: User; services: AdminService[]; compact?: boolean }) {
  const list = services.filter((s) => s.status !== 'ARCHIVED' || value.includes(s.serviceId));
  const editable = (id: string) => actor.role === 'SUPER_ADMIN' || (actor.delegatedServices || []).includes(id);
  const allEditable = list.filter((s) => editable(s.serviceId)).map((s) => s.serviceId);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <button type="button" className="btn small secondary" onClick={() => onChange(Array.from(new Set([...value, ...allEditable])))}>전체 서비스 선택</button>
        <button type="button" className="btn small secondary" onClick={() => onChange(value.filter((id) => !allEditable.includes(id)))}>전체 선택 해제</button>
        <span className="small muted">“전체 선택”은 현재 등록된 서비스만 선택하며, 이후 신규 서비스 권한을 자동 부여하지 않습니다.</span>
      </div>
      {list.length === 0 && <span className="small muted">등록된 서비스가 없습니다.</span>}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2 }}>
        {list.map((s) => (
          <Check
            key={s.serviceId}
            checked={value.includes(s.serviceId)}
            disabled={!editable(s.serviceId)}
            onChange={(on) => onChange(on ? [...value, s.serviceId] : value.filter((x) => x !== s.serviceId))}
            label={<span>{s.serviceName} <span className="small muted">({SERVICE_STATUS_LABEL[s.effectiveStatus]})</span></span>}
            hint={editable(s.serviceId) ? undefined : '위임받지 않은 서비스'}
          />
        ))}
      </div>
    </div>
  );
}

const emptyForm = {
  username: '', displayName: '', organization: '', department: '', position: '', email: '', phone: '',
  role: 'USER' as Role, status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE', validFrom: todayKey(), validUntil: '',
  allowedServices: [] as string[], delegatedServices: [] as string[], groups: '', memo: '', passwordMode: 'generate' as 'generate' | 'manual', password: '',
};

function UserForm({ initial, onClose, onSaved }: { initial: User | null; onClose: () => void; onSaved: () => void }) {
  const { user: actor } = useAuth();
  const { services } = useAdmin();
  const toast = useToast();
  const [f, setF] = useState(() => initial ? {
    ...emptyForm, ...initial, groups: (initial.groups || []).join(', '), memo: initial.memo || '', passwordMode: 'generate' as const, password: '',
  } : { ...emptyForm });
  const [reauth, setReauth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  if (!actor) return null;
  const sup = isSuperAdmin(actor);
  const roleChanged = initial ? f.role !== initial.role : f.role !== 'USER';
  const needReauth = roleChanged;

  const submit = async () => {
    setBusy(true);
    setError('');
    const fields = {
      displayName: f.displayName, organization: f.organization, department: f.department, position: f.position, email: f.email, phone: f.phone,
      role: f.role, status: f.status, validFrom: f.validFrom, validUntil: f.validUntil, allowedServices: f.allowedServices,
      groups: f.groups.split(',').map((g) => g.trim()).filter(Boolean), memo: f.memo,
      ...(sup && f.role === 'ADMIN' ? { delegatedServices: f.delegatedServices } : {}),
    };
    try {
      if (initial) {
        await api('admin.users.update', { uid: initial.uid, patch: fields, reauthPassword: needReauth ? reauth : undefined });
        toast('사용자 정보를 저장했습니다.', 'ok');
        onSaved();
        onClose();
      } else {
        const r = await api<{ user: User; temporaryPassword?: string }>('admin.users.create', {
          ...fields, username: f.username, generatePassword: f.passwordMode === 'generate', password: f.passwordMode === 'manual' ? f.password : '',
          reauthPassword: needReauth ? reauth : undefined,
        });
        toast(`${r.user.username} 계정을 등록했습니다.`, 'ok');
        onSaved();
        if (r.temporaryPassword) setSecret(r.temporaryPassword);
        else onClose();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setReauth('');
    }
  };

  if (secret) {
    return (
      <Modal title="임시 비밀번호 발급 완료" onClose={onClose} footer={<button className="btn" onClick={onClose}>확인했습니다</button>}>
        <p>아이디 <strong>{f.username.toLowerCase()}</strong> 의 임시 비밀번호입니다. 사용자는 최초 로그인 시 비밀번호를 변경해야 합니다.</p>
        <SecretOnce value={secret} label="임시 비밀번호" />
      </Modal>
    );
  }
  const roleOptions = (sup ? ['USER', 'ADMIN', 'SUPER_ADMIN'] : ['USER']).map((r) => ({ value: r as Role, label: ROLE_LABEL[r] }));
  return (
    <Modal
      title={initial ? `사용자 정보 수정 — ${initial.username}` : '신규 사용자 등록'}
      onClose={onClose}
      size="wide"
      footer={<><button className="btn secondary" onClick={onClose}>취소</button><button className="btn" disabled={busy} onClick={submit}>{busy && <Spinner small />} {initial ? '저장' : '등록'}</button></>}
    >
      <div className="stack">
        <div className="form-grid">
          <TextField label="사용자 이름" required value={f.displayName} onChange={(v) => set('displayName', v)} maxLength={50} />
          <TextField label="사용자 아이디" required value={f.username} onChange={(v) => set('username', v)} disabled={!!initial} hint="영문 소문자·숫자로 시작, 3~32자 (. _ - 사용 가능). 대소문자는 구분하지 않습니다." autoComplete="off" maxLength={32} />
          <SelectField label="사용자 역할" required value={f.role} onChange={(v) => set('role', v)} options={roleOptions} disabled={initial?.uid === actor.uid} />
          <SelectField label="계정 상태" value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }]} disabled={initial?.uid === actor.uid} />
          <TextField label="소속 기관" value={f.organization} onChange={(v) => set('organization', v)} maxLength={100} />
          <TextField label="부서" value={f.department} onChange={(v) => set('department', v)} maxLength={100} />
          <TextField label="직책" value={f.position} onChange={(v) => set('position', v)} maxLength={100} />
          <TextField label="이메일 (선택)" type="email" value={f.email} onChange={(v) => set('email', v)} inputMode="email" />
          <TextField label="연락처 (선택)" type="tel" value={f.phone} onChange={(v) => set('phone', v)} inputMode="tel" />
          <TextField label="계정 사용 시작일" type="date" value={f.validFrom} onChange={(v) => set('validFrom', v)} />
          <TextField label="계정 사용 종료일 (선택)" type="date" value={f.validUntil} onChange={(v) => set('validUntil', v)} hint="비워 두면 기간 제한이 없습니다." />
          <TextField label="사용자 그룹 (쉼표 구분)" value={f.groups} onChange={(v) => set('groups', v)} hint="서비스 권한 정책의 그룹 조건에 사용" />
        </div>
        {!initial && (
          <div className="panel" style={{ padding: 14 }}>
            <div className="label" style={{ fontWeight: 500, marginBottom: 6 }}>초기 비밀번호</div>
            <div className="row">
              <label className="check"><input type="radio" checked={f.passwordMode === 'generate'} onChange={() => set('passwordMode', 'generate')} /> 안전한 임시 비밀번호 자동 생성 (등록 후 한 번만 표시)</label>
              <label className="check"><input type="radio" checked={f.passwordMode === 'manual'} onChange={() => set('passwordMode', 'manual')} /> 관리자 직접 지정</label>
            </div>
            {f.passwordMode === 'manual' && <PasswordField label="초기 비밀번호" value={f.password} onChange={(v) => set('password', v)} autoComplete="new-password" hint="12자 이상, 3종류 이상의 문자" />}
            <div className="small muted" style={{ marginTop: 6 }}>신규 계정은 최초 로그인 시 비밀번호 변경이 필수입니다.</div>
          </div>
        )}
        <div>
          <div className="label" style={{ fontWeight: 500, marginBottom: 6 }}>서비스별 접근 권한 {f.role === 'SUPER_ADMIN' && <span className="small muted">(최고관리자는 활성화된 전체 서비스에 접근)</span>}</div>
          <ServicePermissionChecklist value={f.allowedServices} onChange={(v) => set('allowedServices', v)} actor={actor} services={services} />
        </div>
        {sup && f.role === 'ADMIN' && (
          <div>
            <div className="label" style={{ fontWeight: 500, marginBottom: 6 }}>위임 서비스 (운영관리자가 관리·권한 부여할 수 있는 서비스)</div>
            <ServicePermissionChecklist value={f.delegatedServices} onChange={(v) => set('delegatedServices', v)} actor={actor} services={services} />
          </div>
        )}
        <TextArea label="관리자 메모" value={f.memo} onChange={(v) => set('memo', v)} rows={2} maxLength={1000} />
        {needReauth && <PasswordField label="관리자 재인증 (역할 변경·관리자 계정 생성 시 필요)" value={reauth} onChange={setReauth} autoComplete="current-password" />}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ target, onClose }: { target: User; onClose: () => void }) {
  const [mode, setMode] = useState<'generate' | 'manual'>('generate');
  const [pw, setPw] = useState('');
  const [reauth, setReauth] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ temporaryPassword?: string }>('admin.users.resetPassword', { uid: target.uid, generatePassword: mode === 'generate', password: mode === 'manual' ? pw : '', reauthPassword: reauth || undefined });
      if (r.temporaryPassword) setSecret(r.temporaryPassword);
      else { toast('비밀번호를 초기화했습니다.', 'ok'); onClose(); }
    } catch (e) {
      setError(errorText(e));
    } finally { setBusy(false); }
  };
  if (secret) return <Modal title="비밀번호 초기화 완료" onClose={onClose} footer={<button className="btn" onClick={onClose}>확인했습니다</button>}><SecretOnce value={secret} label={`${target.username} 의 새 임시 비밀번호`} /></Modal>;
  return (
    <Modal title={`비밀번호 초기화 — ${target.username}`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>취소</button><button className="btn danger" disabled={busy} onClick={submit}>{busy && <Spinner small />} 초기화</button></>}>
      <div className="stack">
        <p className="small">기존 비밀번호를 확인하지 않고 새 초기 비밀번호를 발급합니다. 사용자의 모든 로그인 세션이 종료되고, 다음 로그인 시 비밀번호를 변경해야 합니다.</p>
        <div className="row">
          <label className="check"><input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} /> 임시 비밀번호 자동 생성</label>
          <label className="check"><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> 직접 지정</label>
        </div>
        {mode === 'manual' && <PasswordField label="새 초기 비밀번호" value={pw} onChange={setPw} autoComplete="new-password" />}
        {target.role !== 'USER' && <PasswordField label="관리자 재인증 (관리자 계정 초기화 시 필요)" value={reauth} onChange={setReauth} />}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<{ row: number; username: string; ok: boolean; temporaryPassword?: string; message?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const template = toCsv(['username', 'displayName', 'organization', 'department', 'position', 'email', 'phone', 'validFrom', 'validUntil', 'services', 'groups'], [['hong01', '홍길동', 'PROFCYS', '창업지원팀', '매니저', '', '', todayKey(), '', 'common-work;mentor-matching', '']]);
  const onFile = async (file: File) => {
    setError('');
    const text = await file.text();
    const list = csvToObjects(text);
    if (!list.length) setError('CSV 에 데이터가 없습니다. 첫 줄은 머리글이어야 합니다.');
    if (list.length > 200) setError('한 번에 최대 200명까지 등록할 수 있습니다.');
    setRows(list.slice(0, 200));
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ results: typeof results }>('admin.users.import', {
        rows: rows.map((x) => ({ ...x, allowedServices: (x.services || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean), groups: (x.groups || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean) })),
      });
      setResults(r.results);
      onDone();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="CSV 사용자 일괄 등록" onClose={onClose} size="wide" footer={results ? <button className="btn" onClick={onClose}>닫기</button> : <><button className="btn secondary" onClick={onClose}>취소</button><button className="btn" disabled={!rows.length || busy} onClick={submit}>{busy && <Spinner small />} {rows.length}명 등록</button></>}>
      {results ? (
        <div className="stack">
          <Alert kind="warn">임시 비밀번호는 이 화면에서 한 번만 표시됩니다. 사용자에게 안전하게 전달하세요. (파일로 저장되지 않습니다)</Alert>
          <div className="table-wrap"><table className="table"><thead><tr><th>행</th><th>아이디</th><th>결과</th><th>임시 비밀번호</th></tr></thead><tbody>
            {results.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.username}</td><td>{r.ok ? <Badge kind="ok">등록</Badge> : <Badge kind="err">{r.message}</Badge>}</td><td className="mono">{r.temporaryPassword || ''}</td></tr>)}
          </tbody></table></div>
        </div>
      ) : (
        <div className="stack">
          <p className="small">일반 사용자(USER)만 일괄 등록할 수 있으며, 계정마다 임시 비밀번호가 자동 생성됩니다. CSV 에는 비밀번호를 넣지 마세요.</p>
          <div className="row"><button className="btn small secondary" onClick={() => downloadText('profcys-users-template.csv', template)}><Icon name="download" /> 양식 내려받기</button>
            <input type="file" accept=".csv,text/csv" aria-label="CSV 파일 선택" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} /></div>
          {rows.length > 0 && <div className="small">{rows.length}명 확인됨: {rows.slice(0, 5).map((r) => r.username).join(', ')}{rows.length > 5 ? ' …' : ''}</div>}
          {error && <Alert kind="error">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

export function UsersPage({ createOnOpen }: { createOnOpen?: boolean }) {
  const { user: actor } = useAuth();
  const { services, rev } = useAdmin();
  const toast = useToast();
  const [q, setQ] = useState({ query: '', field: 'all', role: '', status: '', serviceId: '', organization: '', expiringDays: '', sort: 'createdAt', dir: 'desc', page: 1, pageSize: 20 });
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<User | null | 'new'>(createOnOpen ? 'new' : null);
  const [reset, setReset] = useState<User | null>(null);
  const [del, setDel] = useState<User | null>(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<{ action: string; serviceIds: string[]; validUntil: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResponse>('admin.users.list', { ...q, expiringDays: q.expiringDays ? Number(q.expiringDays) : undefined }));
      setError('');
    } catch (e) { setError(errorText(e)); }
  }, [q]);
  useEffect(() => { void load(); }, [load, rev]);
  useEffect(() => { if (createOnOpen) setEdit('new'); }, [createOnOpen]);
  const setQuery = (patch: Partial<typeof q>) => setQ((x) => ({ ...x, page: 1, ...patch }));
  const svcName = useMemo(() => Object.fromEntries(services.map((s) => [s.serviceId, s.serviceName])), [services]);

  const exportCsv = async () => {
    const r = await api<{ items: User[] }>('admin.users.export');
    downloadText(`profcys-users-${todayKey()}.csv`, toCsv(
      ['아이디', '이름', '소속 기관', '부서', '직책', '이메일', '연락처', '역할', '상태', '접근 서비스', '사용 시작일', '사용 종료일', '생성일', '최근 로그인'],
      r.items.map((u) => [u.username, u.displayName, u.organization, u.department, u.position, u.email, u.phone, ROLE_LABEL[u.role], u.status, u.allowedServices.join(';'), u.validFrom, u.validUntil, fmtDateTime(u.createdAt), fmtDateTime(u.lastLoginAt)]),
    ));
  };
  const quick = async (action: string, u: User) => {
    try {
      if (action === 'unlock') await api('admin.users.unlock', { uid: u.uid });
      if (action === 'revoke') await api('admin.users.revokeSessions', { uid: u.uid });
      if (action === 'toggle') await api('admin.users.update', { uid: u.uid, patch: { status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } });
      toast('처리했습니다.', 'ok');
      void load();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const runBulk = async () => {
    if (!bulk) return;
    try {
      const r = await api<{ success: number; failed: number; results: { ok: boolean; message?: string; username?: string }[] }>('admin.users.bulk', { uids: selected, action: bulk.action, serviceIds: bulk.serviceIds, validUntil: bulk.validUntil });
      toast(`일괄 처리: 성공 ${r.success}건, 실패 ${r.failed}건`, r.failed ? 'error' : 'ok');
      setBulk(null);
      setSelected([]);
      void load();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  if (!actor) return null;
  const t = Date.now();
  return (
    <>
      <div className="page-head">
        <div><h1>사용자 계정 관리</h1><p>관리자가 발급한 계정만 로그인할 수 있습니다. 비밀번호는 조회할 수 없으며 초기화만 가능합니다.</p></div>
        <div className="row">
          <button className="btn secondary" onClick={() => void exportCsv()}><Icon name="download" /> CSV 내보내기</button>
          <button className="btn secondary" onClick={() => setImporting(true)}><Icon name="upload" /> CSV 일괄 등록</button>
          <button className="btn" onClick={() => setEdit('new')}><Icon name="person_add" /> 신규 사용자 등록</button>
        </div>
      </div>
      <div className="panel">
        <div className="filters">
          <div className="search"><Icon name="search" /><input className="input" type="search" placeholder="검색어" aria-label="사용자 검색" value={q.query} onChange={(e) => setQuery({ query: e.target.value })} /></div>
          <select className="input" style={{ width: 'auto' }} aria-label="검색 대상" value={q.field} onChange={(e) => setQuery({ field: e.target.value })}><option value="all">전체</option><option value="name">이름</option><option value="username">아이디</option><option value="organization">소속 기관</option></select>
          <select className="input" style={{ width: 'auto' }} aria-label="역할 필터" value={q.role} onChange={(e) => setQuery({ role: e.target.value })}><option value="">모든 역할</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} aria-label="상태 필터" value={q.status} onChange={(e) => setQuery({ status: e.target.value })}><option value="">모든 상태</option><option value="ACTIVE">활성</option><option value="INACTIVE">비활성</option></select>
          <select className="input" style={{ width: 'auto' }} aria-label="서비스 권한 필터" value={q.serviceId} onChange={(e) => setQuery({ serviceId: e.target.value })}><option value="">모든 서비스</option>{services.map((s) => <option key={s.serviceId} value={s.serviceId}>{s.serviceName}</option>)}</select>
          {data && data.organizations.length > 0 && <select className="input" style={{ width: 'auto' }} aria-label="기관 필터" value={q.organization} onChange={(e) => setQuery({ organization: e.target.value })}><option value="">모든 기관</option>{data.organizations.map((o) => <option key={o}>{o}</option>)}</select>}
          <select className="input" style={{ width: 'auto' }} aria-label="만료 예정 필터" value={q.expiringDays} onChange={(e) => setQuery({ expiringDays: e.target.value })}><option value="">만료 예정 전체</option><option value="7">7일 이내 만료</option><option value="30">30일 이내 만료</option></select>
          <select className="input" style={{ width: 'auto' }} aria-label="정렬" value={q.sort + ':' + q.dir} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); setQuery({ sort, dir }); }}>
            <option value="createdAt:desc">등록일 최신순</option><option value="createdAt:asc">등록일 오래된순</option><option value="lastLoginAt:desc">최근 로그인순</option><option value="name:asc">이름순</option><option value="username:asc">아이디순</option>
          </select>
        </div>
        {selected.length > 0 && (
          <div className="alert info" style={{ marginBottom: 12 }}>
            <Icon name="checklist" /><span className="grow">{selected.length}명 선택됨</span>
            <button className="btn small secondary" onClick={() => setBulk({ action: 'grant', serviceIds: [], validUntil: '' })}>권한 일괄 설정</button>
            <button className="btn small secondary" onClick={() => setBulk({ action: 'activate', serviceIds: [], validUntil: '' })}>활성화</button>
            <button className="btn small secondary" onClick={() => setBulk({ action: 'deactivate', serviceIds: [], validUntil: '' })}>비활성화</button>
            <button className="btn small secondary" onClick={() => setBulk({ action: 'setValidity', serviceIds: [], validUntil: '' })}>이용 기간 수정</button>
            <button className="btn small ghost" onClick={() => setSelected([])}>선택 해제</button>
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {!data ? <Loading /> : data.items.length === 0 ? <Empty icon="person_search" title="조건에 맞는 사용자가 없습니다." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={data.items.every((u) => selected.includes(u.uid))} onChange={(e) => setSelected(e.target.checked ? Array.from(new Set([...selected, ...data.items.filter((u) => u.uid !== actor.uid).map((u) => u.uid)])) : selected.filter((id) => !data.items.some((u) => u.uid === id)))} /></th>
                <th>이름 / 아이디</th><th>소속 기관</th><th>역할</th><th>상태</th><th>접근 가능 서비스</th><th className="nowrap">생성일</th><th className="nowrap">만료일</th><th className="nowrap">최근 로그인</th><th>관리</th>
              </tr></thead>
              <tbody>
                {data.items.map((u) => {
                  const until = u.validUntil ? Date.parse(u.validUntil + 'T23:59:59+09:00') : null;
                  const expired = until != null && until < t;
                  const soon = until != null && !expired && until - t < 30 * 86400000;
                  return (
                    <tr key={u.uid}>
                      <td><input type="checkbox" aria-label={`${u.username} 선택`} disabled={u.uid === actor.uid} checked={selected.includes(u.uid)} onChange={(e) => setSelected(e.target.checked ? [...selected, u.uid] : selected.filter((x) => x !== u.uid))} /></td>
                      <td><strong>{u.displayName}</strong><div className="small muted">{u.username}</div></td>
                      <td className="small">{u.organization || '-'}{u.department ? <div className="muted">{u.department}</div> : null}</td>
                      <td><Badge kind={u.role === 'SUPER_ADMIN' ? 'navy' : u.role === 'ADMIN' ? 'info' : undefined}>{ROLE_LABEL[u.role]}</Badge></td>
                      <td>
                        <Badge kind={u.status === 'ACTIVE' && !expired ? 'ok' : 'err'}>{expired ? '기간 만료' : u.status === 'ACTIVE' ? '활성' : '비활성'}</Badge>
                        {u.mustChangePassword && <div><Badge kind="warn">비밀번호 변경 대기</Badge></div>}
                        {u.lockedUntil && u.lockedUntil > t ? <div><Badge kind="err" icon="lock">잠김</Badge></div> : null}
                      </td>
                      <td className="small" style={{ maxWidth: 240 }}>{u.role === 'SUPER_ADMIN' ? '전체 서비스' : u.allowedServices.length ? u.allowedServices.map((id) => svcName[id] || id).join(', ') : <span className="muted">없음</span>}</td>
                      <td className="small nowrap">{fmtDateTime(u.createdAt)}</td>
                      <td className="small nowrap">{u.validUntil ? <span style={{ color: expired ? 'var(--error)' : soon ? 'var(--warning-text)' : undefined }}>{fmtDateStr(u.validUntil)}</span> : '-'}</td>
                      <td className="small nowrap">{fmtDateTime(u.lastLoginAt)}</td>
                      <td className="nowrap">
                        <button className="icon-btn small" title="정보 수정" aria-label={`${u.username} 정보 수정`} onClick={() => setEdit(u)}><Icon name="edit" /></button>
                        <button className="icon-btn small" title="비밀번호 초기화" aria-label={`${u.username} 비밀번호 초기화`} disabled={u.uid === actor.uid} onClick={() => setReset(u)}><Icon name="lock_reset" /></button>
                        <button className="icon-btn small" title={u.status === 'ACTIVE' ? '비활성화' : '활성화'} aria-label={`${u.username} ${u.status === 'ACTIVE' ? '비활성화' : '활성화'}`} disabled={u.uid === actor.uid} onClick={() => void quick('toggle', u)}><Icon name={u.status === 'ACTIVE' ? 'person_off' : 'how_to_reg'} /></button>
                        {u.lockedUntil && u.lockedUntil > t ? <button className="icon-btn small" title="잠금 해제" aria-label="잠금 해제" onClick={() => void quick('unlock', u)}><Icon name="lock_open" /></button> : null}
                        <button className="icon-btn small" title="강제 로그아웃" aria-label={`${u.username} 강제 로그아웃`} disabled={u.uid === actor.uid} onClick={() => void quick('revoke', u)}><Icon name="logout" /></button>
                        {isSuperAdmin(actor) && <button className="icon-btn small" title="영구 삭제" aria-label={`${u.username} 영구 삭제`} disabled={u.uid === actor.uid} onClick={() => setDel(u)}><Icon name="delete" /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onPage={(p) => setQ((x) => ({ ...x, page: p }))} />}
      </div>

      {edit && <UserForm initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void load()} />}
      {reset && <ResetPasswordDialog target={reset} onClose={() => setReset(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => void load()} />}
      {del && (
        <ConfirmDialog
          title="사용자 영구 삭제"
          danger
          requirePassword
          requireText={del.username}
          confirmLabel="영구 삭제"
          message={<><Alert kind="warn">실수에 의한 정보 손실을 막기 위해 <strong>비활성화</strong>를 권장합니다. 영구 삭제하면 인증 계정과 사용자 정보가 삭제되며 복구할 수 없습니다. 접속·감사 기록은 보존 기간 동안 유지됩니다.</Alert></>}
          onConfirm={async (pw) => {
            await api('admin.users.delete', { uid: del.uid, confirmUsername: del.username, reauthPassword: pw });
            toast('삭제했습니다.', 'ok');
            void load();
          }}
          onClose={() => setDel(null)}
        />
      )}
      {bulk && (
        <Modal title="사용자 일괄 관리" onClose={() => setBulk(null)} footer={<><button className="btn secondary" onClick={() => setBulk(null)}>취소</button><button className="btn" onClick={() => void runBulk()}>{selected.length}명에게 적용</button></>}>
          <div className="stack">
            <SelectField label="작업" value={bulk.action} onChange={(v) => setBulk({ ...bulk, action: v })} options={[
              { value: 'grant', label: '선택한 서비스 권한 추가' }, { value: 'revoke', label: '선택한 서비스 권한 회수' }, { value: 'setServices', label: '서비스 권한을 선택한 항목으로 교체' },
              { value: 'activate', label: '계정 활성화' }, { value: 'deactivate', label: '계정 비활성화' }, { value: 'setValidity', label: '이용 종료일 일괄 수정' },
            ]} />
            {['grant', 'revoke', 'setServices'].includes(bulk.action) && <ServicePermissionChecklist value={bulk.serviceIds} onChange={(v) => setBulk({ ...bulk, serviceIds: v })} actor={actor} services={services} />}
            {bulk.action === 'setValidity' && <TextField label="계정 사용 종료일 (비우면 제한 없음)" type="date" value={bulk.validUntil} onChange={(v) => setBulk({ ...bulk, validUntil: v })} />}
          </div>
        </Modal>
      )}
    </>
  );
}

/** 서비스 × 사용자 권한 매트릭스 (체크박스). 서비스 열은 DB 의 서비스 목록으로 자동 생성된다. */
export function PermissionsPage() {
  const { user: actor } = useAuth();
  const { services, rev } = useAdmin();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [dirty, setDirty] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await api<ListResponse>('admin.users.list', { pageSize: 200, sort: 'name', dir: 'asc' });
      setUsers(r.items);
    } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load, rev]);
  if (!actor) return null;
  const cols = services.filter((s) => s.status !== 'ARCHIVED');
  const editable = (id: string) => actor.role === 'SUPER_ADMIN' || (actor.delegatedServices || []).includes(id);
  const list = (users || []).filter((u) => u.role !== 'SUPER_ADMIN' && (!query || (u.displayName + u.username + u.organization).toLowerCase().includes(query.toLowerCase())));
  const pageSize = 25;
  const visible = list.slice((page - 1) * pageSize, page * pageSize);
  const current = (u: User) => dirty[u.uid] || u.allowedServices;
  const toggle = (u: User, id: string, on: boolean) => {
    const cur = current(u);
    setDirty({ ...dirty, [u.uid]: on ? Array.from(new Set([...cur, id])) : cur.filter((x) => x !== id) });
  };
  const save = async () => {
    setSaving(true);
    let ok = 0;
    const failed: string[] = [];
    for (const [uid, allowed] of Object.entries(dirty)) {
      try { await api('admin.users.update', { uid, patch: { allowedServices: allowed } }); ok++; }
      catch (e) { failed.push(`${users?.find((u) => u.uid === uid)?.username}: ${e instanceof ApiError ? e.message : ''}`); }
    }
    setSaving(false);
    setDirty({});
    toast(`권한 저장: ${ok}명 반영${failed.length ? `, 실패 ${failed.length}명` : ''} (서버 즉시 반영)`, failed.length ? 'error' : 'ok');
    if (failed.length) setError(failed.join('\n'));
    void load();
  };
  return (
    <>
      <div className="page-head">
        <div><h1>서비스 접근 권한 관리</h1><p>신규 사용자의 기본 권한은 “접근 불가”입니다. 권한 회수 즉시 이후의 서비스 실행·SSO 검증 요청이 차단됩니다.</p></div>
        <button className="btn" disabled={!Object.keys(dirty).length || saving} onClick={() => void save()}>{saving && <Spinner small />} 변경 사항 저장 ({Object.keys(dirty).length}명)</button>
      </div>
      <div className="panel">
        <div className="filters"><div className="search"><Icon name="search" /><input className="input" type="search" placeholder="이름·아이디·기관 검색" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} aria-label="사용자 검색" /></div>
          <span className="small muted">최고관리자는 활성화된 전체 서비스에 접근하므로 표에서 제외됩니다. 역할·기관·그룹 기반 정책은 [업무 서비스 관리 › 접근 권한]에서 설정합니다.</span></div>
        {error && <Alert kind="error"><span style={{ whiteSpace: 'pre-line' }}>{error}</span></Alert>}
        {!users ? <Loading /> : cols.length === 0 ? <Empty icon="apps" title="등록된 서비스가 없습니다." /> : (
          <div className="table-wrap" style={{ maxHeight: '70vh' }}>
            <table className="table matrix">
              <thead><tr><th>사용자</th>{cols.map((s) => <th key={s.serviceId} className="vert" title={s.serviceId}>{s.serviceName}</th>)}<th>전체</th></tr></thead>
              <tbody>
                {visible.map((u) => {
                  const cur = current(u);
                  return (
                    <tr key={u.uid} style={dirty[u.uid] ? { background: '#fffbea' } : undefined}>
                      <td className="nowrap"><strong>{u.displayName}</strong> <span className="small muted">{u.username}</span><div className="small muted">{ROLE_LABEL[u.role]}{u.organization ? ' · ' + u.organization : ''}</div></td>
                      {cols.map((s) => (
                        <td key={s.serviceId} className="cell"><input type="checkbox" aria-label={`${u.username} — ${s.serviceName}`} checked={cur.includes(s.serviceId)} disabled={!editable(s.serviceId)} onChange={(e) => toggle(u, s.serviceId, e.target.checked)} /></td>
                      ))}
                      <td className="nowrap">
                        <button className="btn small ghost" onClick={() => setDirty({ ...dirty, [u.uid]: Array.from(new Set([...cur, ...cols.filter((s) => editable(s.serviceId)).map((s) => s.serviceId)])) })}>전체</button>
                        <button className="btn small ghost" onClick={() => setDirty({ ...dirty, [u.uid]: cur.filter((id) => !editable(id)) })}>해제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={list.length} pageSize={pageSize} onPage={setPage} />
      </div>
    </>
  );
}
