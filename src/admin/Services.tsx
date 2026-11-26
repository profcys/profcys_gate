/**
 * 업무 서비스 관리 (14·15·16·17·30장)
 * - 간편 등록 / 6단계 상세 등록 마법사 / 수정 / 운영 상태 변경 / 공개 승인
 * - 드래그 앤 드롭 + 키보드 순서 변경, 변경 이력·복원, URL 검증, 통합 인증 키 발급
 * 모든 서비스는 DB 에만 존재하며 저장 즉시 사용자 대시보드에 반영된다 (재배포 불필요).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { isSuperAdmin, useAuth } from '../auth/AuthContext';
import { api, ApiError, errorText } from '../services/api';
import { Alert, Badge, Check, ConfirmDialog, Empty, Icon, Modal, SecretOnce, SelectField, Spinner, TextArea, TextField, useToast } from '../components/ui';
import { DynamicServiceCard } from '../components/DynamicServiceCard';
import {
  AUTH_MODE_LABEL, DIRECT_ACCESS_LABEL, fmtDateTime, fromLocalInput, INTEGRATION_LABEL, OPEN_MODE_LABEL, ROLE_LABEL,
  SERVICE_STATUS_LABEL, SERVICE_TYPE_LABEL, toLocalInput,
} from '../utils/format';
import { useAdmin } from './context';
import type { AccessPolicy, AdminService, Role, ServiceCard, User } from '../types';

const STATUS_KIND: Record<string, 'ok' | 'warn' | 'err' | 'info' | undefined> = {
  ACTIVE: 'ok', SCHEDULED: 'info', MAINTENANCE: 'warn', INACTIVE: 'err', ARCHIVED: undefined, DRAFT: undefined, EXPIRED: 'err',
};
const ICON_CHOICES = ['apps', 'work', 'groups', 'school', 'rocket_launch', 'fact_check', 'assignment', 'psychology', 'smart_toy', 'science', 'insights',
  'description', 'table_chart', 'calendar_month', 'forum', 'support_agent', 'handshake', 'workspace_premium', 'account_balance', 'campaign',
  'folder_shared', 'monitoring', 'dataset', 'quiz', 'badge', 'event_note', 'inventory_2', 'lightbulb', 'mail', 'link'];
const COLOR_CHOICES = ['#2563EB', '#4285F4', '#0F9D58', '#00897B', '#E37400', '#F9AB00', '#D93025', '#9334E6', '#5E35B1', '#102B50', '#455A64', '#1A73E8'];

interface UrlCheck {
  validation: { ok: boolean; errors: { code: string; message: string }[]; warnings: string[]; url: string; serviceType: string; host: string };
  connectivity: null | { state: string; httpStatus: number; note: string; checkedAt: number };
  disclaimer?: string;
}

/** URL 입력 + 즉시 형식 검증(서버 정책과 동일) + 연결 확인 버튼 */
function UrlField({ value, onChange, serviceId, onType }: { value: string; onChange: (v: string) => void; serviceId?: string; onType?: (t: string) => void }) {
  const [check, setCheck] = useState<UrlCheck | null>(null);
  const [probing, setProbing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!value.trim()) { setCheck(null); return; }
    timer.current = window.setTimeout(() => {
      api<UrlCheck>('admin.services.checkUrl', { url: value, serviceId, skipProbe: true })
        .then((r) => { setCheck(r); if (r.validation.ok && onType) onType(r.validation.serviceType); })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, serviceId]);
  const probe = async () => {
    setProbing(true);
    try { setCheck(await api<UrlCheck>('admin.services.checkUrl', { url: value, serviceId })); } catch (e) { setCheck(null); alertError(e); } finally { setProbing(false); }
  };
  const v = check?.validation;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <TextField label="서비스 연결 URL" required value={value} onChange={onChange} inputMode="url" placeholder="https://script.google.com/macros/s/…/exec" hint="https:// 주소만 허용됩니다. 내부망·IP·javascript: 등은 차단됩니다." />
      <div className="row">
        <button type="button" className="btn small secondary" disabled={!v?.ok || probing} onClick={() => void probe()}>{probing ? <Spinner small /> : <Icon name="network_check" />} 연결 확인</button>
        {v && (v.ok ? <Badge kind="ok" icon="check">형식 검증 통과 · {SERVICE_TYPE_LABEL[v.serviceType] || v.serviceType}</Badge> : <Badge kind="err" icon="error">등록 불가</Badge>)}
      </div>
      {v && v.errors.map((e) => <Alert key={e.code} kind="error">{e.message}</Alert>)}
      {v && v.warnings.map((w) => <Alert key={w} kind="warn">{w}</Alert>)}
      {check?.connectivity && (
        <Alert kind={check.connectivity.state === 'NOT_FOUND' ? 'error' : check.connectivity.state === 'REACHABLE' ? 'warn' : 'info'}>
          연결 확인: <strong>{check.connectivity.state}</strong> (HTTP {check.connectivity.httpStatus || '-'}) — {check.connectivity.note}
          {check.disclaimer && <div className="small muted">{check.disclaimer}</div>}
        </Alert>
      )}
    </div>
  );
}

let alertError: (e: unknown) => void = () => undefined;

function toCard(f: Partial<AdminService>): ServiceCard {
  return {
    serviceId: f.serviceId || 'preview', serviceName: f.serviceName || '서비스 이름', englishName: f.englishName || '', icon: f.icon || 'apps',
    primaryColor: f.primaryColor || '#2563EB', backgroundColor: f.backgroundColor, categoryId: f.categoryId || 'etc', sortOrder: 0, isPinned: !!f.isPinned,
    state: 'AVAILABLE', canLaunch: true, description: f.description || '서비스 설명이 이곳에 표시됩니다.', thumbnailUrl: f.thumbnailUrl,
    cardStyle: f.cardStyle, isNew: f.showNewBadge, keywords: f.keywords, serviceType: f.serviceType,
  };
}

function CardPreview({ f }: { f: Partial<AdminService> }) {
  const { categories } = useAdmin();
  const cat = categories.find((c) => c.categoryId === f.categoryId)?.categoryName;
  return (
    <div className="preview-frame" style={{ maxWidth: 340 }} aria-label="카드 미리보기">
      <DynamicServiceCard service={toCard(f)} categoryName={cat} onLaunch={() => undefined}
        display={{ size: 'default', style: (f.cardStyle || 'default') as 'default', showDescription: true, showStatus: true, showLastAccess: false, showLaunchButton: true, variant: 'grid' }} />
    </div>
  );
}

const STEPS = ['기본 정보', '연결 URL', '카드 디자인', '접근 권한', '공개 설정', '연동·보안'];

type Form = Partial<AdminService> & { keywordsText?: string };

/** 상세 등록(6단계 마법사) 및 수정 공용 편집기 */
function ServiceEditor({ initial, onClose }: { initial: AdminService | null; onClose: () => void }) {
  const { user: actor } = useAuth();
  const { categories, reloadServices } = useAdmin();
  const toast = useToast();
  const sup = isSuperAdmin(actor);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(() => initial ? { ...initial, keywordsText: (initial.keywords || []).join(', ') } : {
    serviceName: '', englishName: '', description: '', detailedDescription: '', url: '', categoryId: 'etc', keywordsText: '', icon: 'apps', primaryColor: '#2563EB',
    backgroundColor: '#FFFFFF', thumbnailUrl: '', cardStyle: '', showNewBadge: true, openMode: 'NEW_TAB', ssoTransport: 'POST', authenticationMode: 'UNVERIFIED',
    integrationStatus: 'LINK_ONLY', directAccess: 'UNVERIFIED', securityVerified: false, hideWhenInactive: true, isPinned: false, publishAt: null, expireAt: null,
    accessPolicy: { mode: 'NONE', roles: [], organizations: [], groups: [], denyUserIds: [], applyToFutureMembers: true }, maintenanceMessage: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const pol = (f.accessPolicy || { mode: 'NONE', roles: [], organizations: [], groups: [], denyUserIds: [] }) as AccessPolicy;
  const setPol = (p: Partial<AccessPolicy>) => set('accessPolicy', { ...pol, ...p });
  const delegateOnly = !sup;

  const payload = () => {
    const keys: (keyof AdminService)[] = delegateOnly
      ? ['serviceName', 'englishName', 'description', 'detailedDescription', 'icon', 'primaryColor', 'backgroundColor', 'thumbnailUrl', 'cardStyle', 'maintenanceMessage', 'categoryId']
      : ['serviceName', 'englishName', 'description', 'detailedDescription', 'url', 'serviceType', 'categoryId', 'icon', 'primaryColor', 'backgroundColor', 'thumbnailUrl',
        'cardStyle', 'isPinned', 'showNewBadge', 'publishAt', 'expireAt', 'openMode', 'ssoTransport', 'authenticationMode', 'integrationStatus', 'directAccess',
        'securityVerified', 'accessPolicy', 'maintenanceMessage', 'hideWhenInactive'];
    const out: Record<string, unknown> = {};
    keys.forEach((k) => { out[k] = f[k]; });
    out.keywords = (f.keywordsText || '').split(',').map((s) => s.trim()).filter(Boolean);
    return out;
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (initial) {
        const r = await api<{ changed: string[] }>('admin.services.update', { serviceId: initial.serviceId, baseVersion: initial.version, patch: payload() });
        toast(r.changed.length ? `저장했습니다. 사용자 화면에 즉시 반영됩니다. (${r.changed.length}개 항목)` : '변경된 내용이 없습니다.', 'ok');
      } else {
        const r = await api<{ service: AdminService; next: string }>('admin.services.create', { ...payload(), mode: 'detailed', serviceId: (f as { newId?: string }).newId });
        toast(`“${r.service.serviceName}” 을(를) 초안으로 등록했습니다. ${r.next}`, 'ok');
      }
      await reloadServices();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') setConflict(true);
      setError(errorText(e));
    } finally { setBusy(false); }
  };
  const canNext = step !== 0 || !!f.serviceName?.trim();
  const isLast = step === STEPS.length - 1;
  const visibleSteps = delegateOnly ? [0, 2] : STEPS.map((_, i) => i);

  return (
    <Modal title={initial ? `서비스 수정 — ${initial.serviceName}` : '업무 서비스 상세 등록'} onClose={onClose} size="xwide" footer={
      <>
        <button className="btn secondary" onClick={onClose}>취소</button>
        {!initial && step > 0 && <button className="btn secondary" onClick={() => setStep(step - 1)}>이전</button>}
        {!initial && !isLast && <button className="btn" disabled={!canNext} onClick={() => setStep(step + 1)}>다음</button>}
        {(initial || isLast) && <button className="btn" disabled={busy || !f.serviceName?.trim() || (!initial && !f.url)} onClick={() => void save()}>{busy && <Spinner small />} {initial ? '저장' : '초안으로 등록'}</button>}
      </>
    }>
      <div className="steps" role="tablist" aria-label="등록 단계">
        {STEPS.map((s, i) => visibleSteps.includes(i) && (
          <button key={s} type="button" role="tab" aria-selected={i === step} className={`step${i === step ? ' active' : i < step ? ' done' : ''}`} onClick={() => (initial || i <= step) && setStep(i)}>
            <span className="n">{i + 1}</span> {s}
          </button>
        ))}
      </div>
      <div className="grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
        <div className="stack">
          {step === 0 && (
            <>
              <div className="form-grid">
                <TextField label="서비스 명칭" required value={f.serviceName || ''} onChange={(v) => set('serviceName', v)} maxLength={60} />
                <TextField label="영문 명칭" value={f.englishName || ''} onChange={(v) => set('englishName', v)} maxLength={80} />
                <SelectField label="카테고리" value={f.categoryId || 'etc'} onChange={(v) => set('categoryId', v)} options={categories.map((c) => ({ value: c.categoryId, label: c.categoryName }))} />
                {!initial && <TextField label="서비스 ID (선택)" value={(f as { newId?: string }).newId || ''} onChange={(v) => setF((x) => ({ ...x, newId: v }))} hint="비워 두면 영문 명칭 또는 임의 값으로 자동 생성. 소문자·숫자·하이픈" />}
              </div>
              <TextField label="짧은 설명 (카드 표시)" value={f.description || ''} onChange={(v) => set('description', v)} maxLength={200} />
              <TextArea label="상세 설명" value={f.detailedDescription || ''} onChange={(v) => set('detailedDescription', v)} rows={3} maxLength={2000} />
              <TextField label="검색 키워드 (쉼표 구분)" value={f.keywordsText || ''} onChange={(v) => set('keywordsText', v)} />
            </>
          )}
          {step === 1 && !delegateOnly && (
            <>
              <UrlField value={f.url || ''} onChange={(v) => set('url', v)} serviceId={initial?.serviceId} onType={(t) => set('serviceType', t)} />
              {initial?.isInitialService && <Alert kind="warn">초기 등록 서비스입니다. 기존 운영 URL 은 관리자 승인 없이 변경하지 마세요.</Alert>}
              <SelectField label="서비스 유형" value={f.serviceType || 'OTHER'} onChange={(v) => set('serviceType', v)} options={Object.entries(SERVICE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <div className="label" style={{ fontWeight: 500, marginBottom: 6 }}>아이콘</div>
                <div className="icon-grid" role="group" aria-label="아이콘 선택">
                  {ICON_CHOICES.map((i) => <button key={i} type="button" aria-pressed={f.icon === i} aria-label={i} onClick={() => set('icon', i)}><Icon name={i} /></button>)}
                </div>
                <TextField label="직접 입력 (Material Symbols 이름)" value={f.icon || ''} onChange={(v) => set('icon', v)} maxLength={40} />
              </div>
              <div>
                <div className="label" style={{ fontWeight: 500, marginBottom: 6 }}>대표 색상</div>
                <div className="swatches" role="group" aria-label="대표 색상">
                  {COLOR_CHOICES.map((c) => <button key={c} type="button" className="swatch" aria-pressed={f.primaryColor === c} aria-label={c} style={{ background: c }} onClick={() => set('primaryColor', c)} />)}
                  <input type="color" aria-label="사용자 지정 색상" value={f.primaryColor || '#2563EB'} onChange={(e) => set('primaryColor', e.target.value.toUpperCase())} />
                </div>
              </div>
              <div className="form-grid">
                <SelectField label="카드 스타일" value={(f.cardStyle || '') as string} onChange={(v) => set('cardStyle', v as AdminService['cardStyle'])} options={[
                  { value: '', label: '화면 구성 기본값 따름' }, { value: 'default', label: '기본형' }, { value: 'icon', label: '아이콘 강조형' },
                  { value: 'thumbnail', label: '썸네일형' }, { value: 'list', label: '목록형' }, { value: 'color', label: '색상 강조형' },
                ]} />
                <TextField label="카드 배경색" value={f.backgroundColor || '#FFFFFF'} onChange={(v) => set('backgroundColor', v)} hint="#RRGGBB" />
              </div>
              <TextField label="썸네일 이미지 URL (선택, https)" value={f.thumbnailUrl || ''} onChange={(v) => set('thumbnailUrl', v)} inputMode="url" />
            </>
          )}
          {step === 3 && !delegateOnly && (
            <>
              <Alert kind="info">신규 서비스는 기본적으로 <strong>접근 불가</strong>입니다. 개별 사용자 권한은 저장 후 [사용자 권한 지정] 또는 [서비스 접근 권한 관리]에서 부여하세요.</Alert>
              <SelectField label="정책 기반 접근 허용" value={pol.mode} onChange={(v) => setPol({ mode: v })} options={[
                { value: 'NONE', label: '개별 지정 사용자만 (기본값)' }, { value: 'ADMINS', label: '관리자(최고·운영)만' },
                { value: 'RULES', label: '역할·기관·그룹 조건 충족 사용자' }, { value: 'ALL', label: '모든 활성 사용자' },
              ]} />
              {pol.mode === 'ALL' && <Alert kind="warn">모든 활성 사용자에게 공개됩니다. 민감한 업무 서비스에는 사용하지 마세요.</Alert>}
              {pol.mode === 'RULES' && (
                <div className="stack">
                  <div className="row">{(['USER', 'ADMIN'] as Role[]).map((r) => <Check key={r} label={ROLE_LABEL[r]} checked={pol.roles.includes(r)} onChange={(on) => setPol({ roles: on ? [...pol.roles, r] : pol.roles.filter((x) => x !== r) })} />)}</div>
                  <TextField label="소속 기관 (쉼표 구분)" value={pol.organizations.join(', ')} onChange={(v) => setPol({ organizations: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
                  <TextField label="사용자 그룹 (쉼표 구분)" value={pol.groups.join(', ')} onChange={(v) => setPol({ groups: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
                  <Check label="이후 조건에 해당하게 되는 사용자에게도 자동 적용" checked={pol.applyToFutureMembers !== false} onChange={(v) => setPol({ applyToFutureMembers: v })} />
                  <span className="small muted">여러 조건을 지정하면 모두 충족해야 합니다. 거부 목록(denyUserIds)이 항상 우선합니다.</span>
                </div>
              )}
            </>
          )}
          {step === 4 && !delegateOnly && (
            <>
              <Alert kind="info">공개(ACTIVE)·예약 공개는 저장 후 목록의 [공개 승인] 버튼으로만 진행됩니다. 여기서는 일정과 표시 방식을 설정합니다.</Alert>
              <div className="form-grid">
                <TextField label="공개 시작 (예약 공개용)" type="datetime-local" value={toLocalInput(f.publishAt)} onChange={(v) => set('publishAt', fromLocalInput(v))} />
                <TextField label="공개 종료 (선택)" type="datetime-local" value={toLocalInput(f.expireAt)} onChange={(v) => set('expireAt', fromLocalInput(v))} />
                <SelectField label="실행 방식" value={(f.openMode || 'NEW_TAB') as string} onChange={(v) => set('openMode', v as AdminService['openMode'])} options={Object.entries(OPEN_MODE_LABEL).map(([value, label]) => ({ value, label }))} />
                {f.openMode === 'SSO' && <SelectField label="인증 코드 전달 방식" value={(f.ssoTransport || 'POST') as string} onChange={(v) => set('ssoTransport', v as 'POST' | 'QUERY')} options={[{ value: 'POST', label: 'POST 폼 전송 (권장, 주소창·기록에 남지 않음)' }, { value: 'QUERY', label: 'URL 쿼리 (?profcys_code=)' }]} />}
              </div>
              {f.openMode === 'EMBED' && <Alert kind="warn">Apps Script·Google 문서는 보안 정책상 임베딩이 막힐 수 있습니다. 표시되지 않으면 새 탭 방식을 사용하세요.</Alert>}
              <Check label="상단 고정" checked={!!f.isPinned} onChange={(v) => set('isPinned', v)} />
              <Check label="NEW 배지 표시 (공개 후 설정된 기간 동안)" checked={f.showNewBadge !== false} onChange={(v) => set('showNewBadge', v)} />
              <Check label="비활성 시 사용자 화면에서 숨김" checked={f.hideWhenInactive !== false} onChange={(v) => set('hideWhenInactive', v)} />
              <TextField label="점검 안내 문구" value={f.maintenanceMessage || ''} onChange={(v) => set('maintenanceMessage', v)} maxLength={300} />
            </>
          )}
          {step === 5 && !delegateOnly && (
            <>
              <Alert kind="warn">연동 상태는 실제 검증 결과대로만 표시하세요. 통합 인증 모듈 적용과 직접 URL 접근 차단을 확인하기 전에는 “완전한 통합 인증 완료”로 설정할 수 없습니다.</Alert>
              <div className="form-grid">
                <SelectField label="인증 방식" value={f.authenticationMode || 'UNVERIFIED'} onChange={(v) => set('authenticationMode', v)} options={Object.entries(AUTH_MODE_LABEL).map(([value, label]) => ({ value, label }))} />
                <SelectField label="연동 상태" value={f.integrationStatus || 'LINK_ONLY'} onChange={(v) => set('integrationStatus', v)} options={Object.entries(INTEGRATION_LABEL).map(([value, label]) => ({ value, label }))} />
                <SelectField label="직접 URL 접근" value={(f.directAccess || 'UNVERIFIED') as string} onChange={(v) => set('directAccess', v as AdminService['directAccess'])} options={Object.entries(DIRECT_ACCESS_LABEL).map(([value, label]) => ({ value, label }))} />
              </div>
              <Check label="보안 검증 완료 (서비스 담당자가 통합 인증·권한 검사를 직접 확인함)" checked={!!f.securityVerified} onChange={(v) => set('securityVerified', v)} />
            </>
          )}
          {delegateOnly && (step === 1 || step >= 3) && <Alert kind="info">운영관리자는 서비스 표시 정보만 수정할 수 있습니다.</Alert>}
          {error && <Alert kind="error">{error}{conflict && <div><button className="btn small secondary" onClick={() => { void reloadServices(); onClose(); }}>최신 내용 다시 불러오기</button></div>}</Alert>}
        </div>
        <div className="stack">
          <div className="small muted">사용자 대시보드 카드 미리보기</div>
          <CardPreview f={{ ...f, keywords: (f.keywordsText || '').split(',') }} />
          {initial && <div className="small muted">버전 {initial.version} · 최종 수정 {fmtDateTime(initial.updatedAt)}</div>}
        </div>
      </div>
    </Modal>
  );
}

function QuickAdd({ onClose, onDetailed }: { onClose: () => void; onDetailed: () => void }) {
  const { categories, reloadServices } = useAdmin();
  const toast = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [cat, setCat] = useState('etc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ service: AdminService; next: string }>('admin.services.create', { serviceName: name, url, categoryId: cat, mode: 'quick' });
      toast(`“${r.service.serviceName}” 을(를) 초안으로 등록했습니다. ${r.next}`, 'ok');
      await reloadServices();
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="업무 서비스 간편 등록" onClose={onClose} footer={<><button className="btn ghost" onClick={onDetailed}>상세 등록으로 전환</button><button className="btn secondary" onClick={onClose}>취소</button><button className="btn" disabled={busy || !name.trim() || !url.trim()} onClick={() => void submit()}>{busy && <Spinner small />} 초안으로 등록</button></>}>
      <div className="stack">
        <TextField label="서비스 명칭" required value={name} onChange={setName} maxLength={60} />
        <UrlField value={url} onChange={setUrl} />
        <SelectField label="카테고리" value={cat} onChange={setCat} options={categories.map((c) => ({ value: c.categoryId, label: c.categoryName }))} />
        <p className="small muted">아이콘·색상·서비스 유형은 URL 로부터 자동 지정됩니다. 등록 직후에는 <strong>초안(비공개)</strong> 상태이며 아무에게도 표시되지 않습니다.</p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function StatusDialog({ s, onClose }: { s: AdminService; onClose: () => void }) {
  const { reloadServices } = useAdmin();
  const { user } = useAuth();
  const toast = useToast();
  const sup = isSuperAdmin(user);
  const [next, setNext] = useState<string>(s.status === 'DRAFT' ? 'ACTIVE' : s.status);
  const [approve, setApprove] = useState(false);
  const [publishAt, setPublishAt] = useState(toLocalInput(s.publishAt));
  const [msg, setMsg] = useState(s.maintenanceMessage || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const publicTarget = next === 'ACTIVE' || next === 'SCHEDULED';
  const toggle = (next === 'MAINTENANCE' && s.status === 'ACTIVE') || (next === 'ACTIVE' && s.status === 'MAINTENANCE');
  const options = sup ? ['DRAFT', 'ACTIVE', 'SCHEDULED', 'MAINTENANCE', 'INACTIVE', 'ARCHIVED'] : s.status === 'ACTIVE' ? ['ACTIVE', 'MAINTENANCE'] : s.status === 'MAINTENANCE' ? ['MAINTENANCE', 'ACTIVE'] : [s.status];
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ warnings: string[] }>('admin.services.setStatus', { serviceId: s.serviceId, status: next, approve, publishAt: next === 'SCHEDULED' ? fromLocalInput(publishAt) : undefined, maintenanceMessage: next === 'MAINTENANCE' ? msg : undefined });
      toast(`상태를 “${SERVICE_STATUS_LABEL[next]}”(으)로 변경했습니다.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`, r.warnings.length ? 'error' : 'ok');
      await reloadServices();
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`운영 상태 변경 — ${s.serviceName}`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>취소</button><button className="btn" disabled={busy || next === s.status || (publicTarget && !toggle && !approve)} onClick={() => void submit()}>{busy && <Spinner small />} 변경</button></>}>
      <div className="stack">
        <div className="small">현재 상태: <Badge kind={STATUS_KIND[s.effectiveStatus]}>{SERVICE_STATUS_LABEL[s.effectiveStatus]}</Badge></div>
        <SelectField label="변경할 상태" value={next} onChange={setNext} options={options.map((o) => ({ value: o, label: SERVICE_STATUS_LABEL[o] }))} />
        {next === 'SCHEDULED' && <TextField label="공개 예정 시각" type="datetime-local" value={publishAt} onChange={setPublishAt} />}
        {next === 'MAINTENANCE' && <TextField label="점검 안내 문구" value={msg} onChange={setMsg} maxLength={300} />}
        {next === 'ARCHIVED' && <Alert kind="info">보관된 서비스는 사용자에게 표시되지 않으며, 이후 영구 삭제할 수 있습니다. 외부 Apps Script 와 업무 데이터는 영향을 받지 않습니다.</Alert>}
        {publicTarget && !toggle && (
          <div className="panel" style={{ padding: 14 }}>
            <strong>공개 전 확인 사항</strong>
            <ul className="small" style={{ margin: '6px 0 10px 18px' }}>
              <li>URL 검증: 공개 시 서버가 현재 정책으로 다시 검증합니다.</li>
              <li>접근 권한: {s.accessPolicy.mode === 'NONE' ? `개별 지정 사용자 ${s.permittedUserCount ?? 0}명` : s.accessPolicy.mode}</li>
              <li>연동 상태: {INTEGRATION_LABEL[s.integrationStatus]} · {DIRECT_ACCESS_LABEL[s.directAccess]}</li>
              <li>보안 검증: {s.securityVerified ? '완료' : <span style={{ color: 'var(--warning-text)' }}>미완료</span>}</li>
            </ul>
            <Check label="위 내용을 확인했으며 이 서비스의 공개를 승인합니다." checked={approve} onChange={setApprove} />
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

interface ChangeLog { logId: string; action: string; adminUsername: string; changeSummary: string; timestamp: number; previousSettings: Record<string, unknown> | null; updatedSettings: Record<string, unknown> | null }

function HistoryDialog({ s, onClose }: { s: AdminService; onClose: () => void }) {
  const { user } = useAuth();
  const { reloadServices } = useAdmin();
  const toast = useToast();
  const [items, setItems] = useState<ChangeLog[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ChangeLog | null>(null);
  useEffect(() => { api<{ items: ChangeLog[] }>('admin.services.history', { serviceId: s.serviceId }).then((r) => setItems(r.items)).catch((e) => setError(errorText(e))); }, [s.serviceId]);
  const diff = (l: ChangeLog) => {
    const a = l.previousSettings || {};
    const b = l.updatedSettings || {};
    return Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((k) => !['updatedAt', 'updatedBy', 'version'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  };
  return (
    <Modal title={`변경 이력 — ${s.serviceName}`} onClose={onClose} size="wide">
      {error && <Alert kind="error">{error}</Alert>}
      {!items ? <Spinner /> : items.length === 0 ? <Empty title="변경 이력이 없습니다." /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>시각</th><th>작업자</th><th>작업</th><th>요약</th><th></th></tr></thead><tbody>
          {items.map((l) => (
            <>
              <tr key={l.logId}>
                <td className="small nowrap">{fmtDateTime(l.timestamp, true)}</td><td className="small">{l.adminUsername}</td><td><Badge>{l.action}</Badge></td><td className="small">{l.changeSummary}</td>
                <td className="nowrap">
                  <button className="btn small ghost" onClick={() => setOpen(open === l.logId ? null : l.logId)}>{open === l.logId ? '닫기' : '상세'}</button>
                  {isSuperAdmin(user) && l.previousSettings && <button className="btn small secondary" onClick={() => setConfirm(l)}>이 변경 이전으로 복원</button>}
                </td>
              </tr>
              {open === l.logId && (
                <tr key={l.logId + '-d'}><td colSpan={5}>
                  <table className="table"><thead><tr><th>항목</th><th>이전</th><th>이후</th></tr></thead><tbody>
                    {diff(l).map((k) => <tr key={k}><td className="mono small">{k}</td><td className="mono small" style={{ wordBreak: 'break-all' }}>{JSON.stringify(l.previousSettings?.[k] ?? null)}</td><td className="mono small" style={{ wordBreak: 'break-all' }}>{JSON.stringify(l.updatedSettings?.[k] ?? null)}</td></tr>)}
                  </tbody></table>
                </td></tr>
              )}
            </>
          ))}
        </tbody></table></div>
      )}
      {confirm && (
        <ConfirmDialog title="이전 설정으로 복원" confirmLabel="복원"
          message={<>
            <p>{fmtDateTime(confirm.timestamp)} 의 변경 이전 설정으로 되돌립니다.</p>
            <Alert kind="info">URL 은 현재 보안 정책으로 다시 검증됩니다. 접근 권한 정책과 인증·보안 검증 상태는 현재 값을 유지하며, 공개 상태는 자동으로 복원하지 않습니다(초안으로 설정 후 재승인 필요).</Alert>
          </>}
          onConfirm={async () => {
            const r = await api<{ notes: string[] }>('admin.services.restore', { logId: confirm.logId, which: 'previous' });
            toast('복원했습니다. ' + r.notes.join(' '), 'ok');
            await reloadServices();
            onClose();
          }}
          onClose={() => setConfirm(null)} />
      )}
    </Modal>
  );
}

function GrantsDialog({ s, onClose }: { s: AdminService; onClose: () => void }) {
  const { reloadServices } = useAdmin();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ items: User[] }>('admin.users.list', { pageSize: 200, sort: 'name', dir: 'asc' }).then((r) => {
      const list = r.items.filter((u) => u.role !== 'SUPER_ADMIN');
      setUsers(list);
      setSel(new Set(list.filter((u) => u.allowedServices.includes(s.serviceId)).map((u) => u.uid)));
    }).catch((e) => toast(errorText(e), 'error'));
  }, [s.serviceId, toast]);
  const save = async () => {
    if (!users) return;
    setBusy(true);
    const had = new Set(users.filter((u) => u.allowedServices.includes(s.serviceId)).map((u) => u.uid));
    const grantUids = [...sel].filter((id) => !had.has(id));
    const revokeUids = [...had].filter((id) => !sel.has(id));
    try {
      const r = await api<{ results: { ok: boolean }[] }>('admin.services.setUserGrants', { serviceId: s.serviceId, grantUids, revokeUids });
      const failed = r.results.filter((x) => !x.ok).length;
      toast(`권한 부여 ${grantUids.length}명, 회수 ${revokeUids.length}명${failed ? ` (실패 ${failed})` : ''}`, failed ? 'error' : 'ok');
      await reloadServices();
      onClose();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const list = (users || []).filter((u) => !query || (u.displayName + u.username + u.organization).toLowerCase().includes(query.toLowerCase()));
  return (
    <Modal title={`사용자 권한 지정 — ${s.serviceName}`} onClose={onClose} size="wide" footer={<><button className="btn secondary" onClick={onClose}>취소</button><button className="btn" disabled={busy || !users} onClick={() => void save()}>{busy && <Spinner small />} 저장 ({sel.size}명)</button></>}>
      {!users ? <Spinner /> : (
        <div className="stack">
          <input className="input" type="search" placeholder="이름·아이디·기관 검색" aria-label="사용자 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div style={{ maxHeight: 380, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
            {list.map((u) => <Check key={u.uid} checked={sel.has(u.uid)} onChange={(on) => { const n = new Set(sel); if (on) n.add(u.uid); else n.delete(u.uid); setSel(n); }} label={<span>{u.displayName} <span className="small muted">{u.username}{u.status !== 'ACTIVE' ? ' · 비활성' : ''}</span></span>} />)}
          </div>
          <span className="small muted">회수는 즉시 반영되어 이후 서비스 실행과 SSO 검증이 거부됩니다.</span>
        </div>
      )}
    </Modal>
  );
}

function KeyDialog({ s, onClose }: { s: AdminService; onClose: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const issued = useRef(false);
  const { reloadServices } = useAdmin();
  if (key) return <Modal title="통합 인증 키 발급 완료" onClose={() => { void reloadServices(); onClose(); }}><div className="stack"><SecretOnce value={key} label="서비스 키 (PROFCYS_SERVICE_KEY)" /><p className="small">해당 Apps Script 편집기 › 프로젝트 설정 › 스크립트 속성에 <code>PROFCYS_SERVICE_KEY</code> 로 저장하세요. 키 원문은 서버에 저장되지 않으며 다시 볼 수 없습니다. 재발급하면 이전 키는 즉시 무효가 됩니다.</p></div></Modal>;
  return (
    <ConfirmDialog title={`통합 인증 키 ${s.hasIntegrationKey ? '재발급' : '발급'} — ${s.serviceName}`} requirePassword confirmLabel="발급"
      message={<p>업무 시스템(Apps Script)이 PROFCYS 인증 코드를 검증할 때 사용하는 서비스 전용 키를 발급합니다.{s.hasIntegrationKey && <strong> 기존 키는 즉시 사용할 수 없게 됩니다.</strong>}</p>}
      onConfirm={async (pw) => { const r = await api<{ serviceKey: string }>('admin.services.rotateKey', { serviceId: s.serviceId, reauthPassword: pw }); issued.current = true; setKey(r.serviceKey); }}
      onClose={() => { if (!issued.current) onClose(); }} />
  );
}

export function ServicesPage() {
  const { user } = useAuth();
  const { services, categories, reloadServices } = useAdmin();
  const toast = useToast();
  alertError = (e) => toast(errorText(e), 'error');
  const sup = isSuperAdmin(user);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [cat, setCat] = useState('');
  const [order, setOrder] = useState<AdminService[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ type: 'quick' | 'new' | 'edit' | 'status' | 'history' | 'grants' | 'key' | 'purge'; s?: AdminService } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkCat, setBulkCat] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => (order || services).filter((s) =>
    (!status || s.effectiveStatus === status) && (!cat || s.categoryId === cat) &&
    (!query || [s.serviceName, s.englishName, s.serviceId, s.url, ...(s.keywords || [])].join(' ').toLowerCase().includes(query.toLowerCase()))), [order, services, status, cat, query]);
  const reordering = !!order;
  const catName = (id: string) => categories.find((c) => c.categoryId === id)?.categoryName || id;

  const move = (id: string, delta: number, list = order || services.slice()) => {
    const i = list.findIndex((s) => s.serviceId === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const copy = list.slice();
    const [x] = copy.splice(i, 1);
    copy.splice(j, 0, x);
    setOrder(copy);
  };
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const list = (order || services).slice();
    const from = list.findIndex((s) => s.serviceId === dragId);
    const to = list.findIndex((s) => s.serviceId === targetId);
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
    setOrder(list);
    setDragId(null);
  };
  const saveOrder = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const r = await api<{ updated: number }>('admin.services.reorder', { items: order.map((s, i) => ({ serviceId: s.serviceId, sortOrder: (i + 1) * 10, isPinned: s.isPinned })) });
      toast(`표시 순서를 저장했습니다. (${r.updated}개 변경)`, 'ok');
      setOrder(null);
      await reloadServices();
    } catch (e) { toast(errorText(e), 'error'); } finally { setSaving(false); }
  };
  const togglePin = (s: AdminService) => {
    const list = (order || services).map((x) => x.serviceId === s.serviceId ? { ...x, isPinned: !x.isPinned } : x);
    setOrder(list.sort((a, b) => Number(b.isPinned) - Number(a.isPinned)));
  };
  const applyBulkCat = async () => {
    try {
      const r = await api<{ updated: number }>('admin.services.bulkCategory', { serviceIds: selected, categoryId: bulkCat });
      toast(`${r.updated}개 서비스의 카테고리를 변경했습니다.`, 'ok');
      setSelected([]);
      await reloadServices();
    } catch (e) { toast(errorText(e), 'error'); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>업무 서비스 관리</h1><p>등록·수정·공개 상태 변경이 즉시 사용자 대시보드에 반영됩니다. 소스코드 수정이나 재배포가 필요하지 않습니다.</p></div>
        {sup && <div className="row"><button className="btn secondary" onClick={() => setDialog({ type: 'quick' })}><Icon name="bolt" /> 간편 등록</button><button className="btn" onClick={() => setDialog({ type: 'new' })}><Icon name="add" /> 상세 등록</button></div>}
      </div>
      <div className="panel">
        <div className="filters">
          <div className="search"><Icon name="search" /><input className="input" type="search" placeholder="서비스 이름·ID·URL·키워드" aria-label="서비스 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <select className="input" style={{ width: 'auto' }} aria-label="상태 필터" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">모든 상태</option>{Object.entries(SERVICE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} aria-label="카테고리 필터" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">모든 카테고리</option>{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}</select>
          <span className="small muted">총 {services.length}개 · 표시 {filtered.length}개</span>
        </div>
        {sup && reordering && (
          <Alert kind="info"><span className="grow">순서를 변경했습니다. 저장해야 사용자 화면에 반영됩니다.</span> <button className="btn small" disabled={saving} onClick={() => void saveOrder()}>{saving && <Spinner small />} 순서 저장</button> <button className="btn small secondary" onClick={() => setOrder(null)}>취소</button></Alert>
        )}
        {sup && selected.length > 0 && (
          <div className="alert info" style={{ marginBottom: 12 }}>
            <span className="grow">{selected.length}개 선택</span>
            <select className="input" style={{ width: 'auto' }} aria-label="일괄 변경할 카테고리" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}><option value="">카테고리 선택</option>{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}</select>
            <button className="btn small" disabled={!bulkCat} onClick={() => void applyBulkCat()}>카테고리 일괄 변경</button>
            <button className="btn small ghost" onClick={() => setSelected([])}>선택 해제</button>
          </div>
        )}
        {services.length === 0 ? <Empty icon="apps" title="등록된 업무 서비스가 없습니다.">{sup && <button className="btn" onClick={() => setDialog({ type: 'quick' })}>첫 서비스 등록</button>}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{sup && <th aria-label="순서" />}{sup && <th aria-label="선택" />}<th>서비스</th><th>카테고리</th><th>상태</th><th>연동·보안</th><th>권한 사용자</th><th className="nowrap">최종 수정</th><th>관리</th></tr></thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.serviceId} draggable={sup && !query && !status && !cat} onDragStart={() => setDragId(s.serviceId)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(s.serviceId)} className={dragId === s.serviceId ? 'dragging' : ''}>
                    {sup && (
                      <td className="nowrap">
                        <span className="drag-handle" title="끌어서 순서 변경" aria-hidden><Icon name="drag_indicator" /></span>
                        <button className="icon-btn small" aria-label={`${s.serviceName} 위로`} onClick={() => move(s.serviceId, -1)}><Icon name="arrow_upward" /></button>
                        <button className="icon-btn small" aria-label={`${s.serviceName} 아래로`} onClick={() => move(s.serviceId, 1)}><Icon name="arrow_downward" /></button>
                      </td>
                    )}
                    {sup && <td><input type="checkbox" aria-label={`${s.serviceName} 선택`} checked={selected.includes(s.serviceId)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.serviceId] : selected.filter((x) => x !== s.serviceId))} /></td>}
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <span className="svc-dot" style={{ background: s.primaryColor }}><Icon name={s.icon} /></span>
                        <div>
                          <strong>{s.serviceName}</strong> {s.isPinned && <Badge kind="navy" icon="push_pin">고정</Badge>} {s.isInitialService && <Badge>초기 서비스</Badge>}
                          <div className="small muted mono">{s.serviceId} · {SERVICE_TYPE_LABEL[s.serviceType] || s.serviceType}</div>
                          <div className="small muted mono" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.url}>{s.url}</div>
                        </div>
                      </div>
                    </td>
                    <td className="small">{catName(s.categoryId)}</td>
                    <td>
                      <Badge kind={STATUS_KIND[s.effectiveStatus]}>{SERVICE_STATUS_LABEL[s.effectiveStatus]}</Badge>
                      {s.effectiveStatus === 'SCHEDULED' && s.publishAt && <div className="small muted">{fmtDateTime(s.publishAt)}</div>}
                      {s.status === 'DRAFT' && s.targetStatus === 'ACTIVE' && <div className="small muted">공개 승인 대기</div>}
                    </td>
                    <td className="small">
                      <div>{INTEGRATION_LABEL[s.integrationStatus] || s.integrationStatus}</div>
                      <div className="muted">{DIRECT_ACCESS_LABEL[s.directAccess]}{s.securityVerified ? ' · 보안 검증 완료' : ''}</div>
                      {sup && s.hasIntegrationKey !== undefined && <div className="muted">인증 키 {s.hasIntegrationKey ? '발급됨' : '미발급'}{s.lastSsoSuccessAt ? ` · 최근 SSO ${fmtDateTime(s.lastSsoSuccessAt)}` : ''}</div>}
                    </td>
                    <td className="small">{s.accessPolicy.mode === 'ALL' ? '전체 사용자' : s.accessPolicy.mode === 'ADMINS' ? '관리자' : ''}{s.permittedUserCount != null && <div>{s.permittedUserCount}명</div>}</td>
                    <td className="small nowrap">{fmtDateTime(s.updatedAt)}</td>
                    <td className="nowrap">
                      <button className="icon-btn small" title="수정" aria-label={`${s.serviceName} 수정`} onClick={() => setDialog({ type: 'edit', s })}><Icon name="edit" /></button>
                      <button className="icon-btn small" title={s.status === 'DRAFT' ? '공개 승인' : '운영 상태 변경'} aria-label={`${s.serviceName} 상태 변경`} onClick={() => setDialog({ type: 'status', s })}><Icon name={s.status === 'DRAFT' ? 'publish' : 'toggle_on'} /></button>
                      <button className="icon-btn small" title="사용자 권한 지정" aria-label={`${s.serviceName} 사용자 권한`} onClick={() => setDialog({ type: 'grants', s })}><Icon name="person_check" /></button>
                      <button className="icon-btn small" title="변경 이력" aria-label={`${s.serviceName} 변경 이력`} onClick={() => setDialog({ type: 'history', s })}><Icon name="history" /></button>
                      {sup && <button className="icon-btn small" title="통합 인증 키" aria-label={`${s.serviceName} 통합 인증 키`} onClick={() => setDialog({ type: 'key', s })}><Icon name="key" /></button>}
                      {sup && <button className="icon-btn small" title={reordering ? '고정 전환' : '상단 고정 전환'} aria-label={`${s.serviceName} 고정 전환`} onClick={() => togglePin(s)}><Icon name="push_pin" fill={s.isPinned} /></button>}
                      {sup && s.status === 'ARCHIVED' && <button className="icon-btn small" title="영구 삭제" aria-label={`${s.serviceName} 영구 삭제`} onClick={() => setDialog({ type: 'purge', s })}><Icon name="delete_forever" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sup && <p className="small muted" style={{ marginTop: 8 }}>순서 변경: 행을 끌어 놓거나 ↑↓ 버튼(키보드 Tab·Enter)으로 이동한 뒤 [순서 저장]을 누르세요. 검색·필터 중에는 끌어 놓기가 비활성화됩니다.</p>}
      </div>

      {dialog?.type === 'quick' && <QuickAdd onClose={() => setDialog(null)} onDetailed={() => setDialog({ type: 'new' })} />}
      {dialog?.type === 'new' && <ServiceEditor initial={null} onClose={() => setDialog(null)} />}
      {dialog?.type === 'edit' && dialog.s && <ServiceEditor initial={dialog.s} onClose={() => setDialog(null)} />}
      {dialog?.type === 'status' && dialog.s && <StatusDialog s={dialog.s} onClose={() => setDialog(null)} />}
      {dialog?.type === 'history' && dialog.s && <HistoryDialog s={dialog.s} onClose={() => setDialog(null)} />}
      {dialog?.type === 'grants' && dialog.s && <GrantsDialog s={dialog.s} onClose={() => setDialog(null)} />}
      {dialog?.type === 'key' && dialog.s && <KeyDialog s={dialog.s} onClose={() => setDialog(null)} />}
      {dialog?.type === 'purge' && dialog.s && (
        <ConfirmDialog title="서비스 영구 삭제" danger requirePassword requireText={dialog.s.serviceId} confirmLabel="영구 삭제"
          message={<Alert kind="warn">PROFCYS 포털에서 이 서비스 정보와 모든 사용자 권한이 삭제됩니다. 서비스 ID 는 재사용되지 않습니다. <strong>외부 Apps Script 프로젝트와 업무 데이터는 삭제되지 않습니다.</strong> 접속 기록은 보존 기간 동안 유지됩니다.</Alert>}
          onConfirm={async (pw) => { await api('admin.services.purge', { serviceId: dialog.s!.serviceId, confirmServiceId: dialog.s!.serviceId, reauthPassword: pw }); toast('삭제했습니다.', 'ok'); await reloadServices(); }}
          onClose={() => setDialog(null)} />
      )}
    </>
  );
}
