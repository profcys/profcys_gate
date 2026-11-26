/** 카테고리 (17장) · 화면 구성 (19장) · 공지사항 (24장) · 시스템 설정 (28장) · 백업 (30장) · 접속 QR (27장) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError, errorText } from '../services/api';
import { Alert, Badge, Check, ConfirmDialog, Empty, Icon, Loading, Modal, PasswordField, SelectField, Spinner, TextArea, TextField, useToast } from '../components/ui';
import { DashboardView } from '../components/DashboardView';
import { ANNOUNCEMENT_CATEGORY_LABEL, fmtDateStr, fmtDateTime, ROLE_LABEL, todayKey } from '../utils/format';
import { downloadText } from '../utils/csv';
import { useAdmin } from './context';
import type { AdminService, Announcement, Category, PlatformSettings, Role, ServiceCard, UiSettings } from '../types';

/* ───────────── 카테고리 ───────────── */

export function CategoriesPage() {
  const { reloadServices, rev } = useAdmin();
  const toast = useToast();
  const [list, setList] = useState<Category[] | null>(null);
  const [edit, setEdit] = useState<Partial<Category> & { newCategoryId?: string } | null>(null);
  const [del, setDel] = useState<Category | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const load = useCallback(() => api<{ categories: Category[] }>('admin.categories.list').then((r) => { setList(r.categories); setDirty(false); }).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => { void load(); }, [load, rev]);
  const move = (from: number, to: number) => {
    if (!list || to < 0 || to >= list.length) return;
    const c = list.slice();
    const [x] = c.splice(from, 1);
    c.splice(to, 0, x);
    setList(c);
    setDirty(true);
  };
  const saveOrder = async () => {
    if (!list) return;
    try {
      await api('admin.categories.reorder', { items: list.map((c, i) => ({ categoryId: c.categoryId, sortOrder: (i + 1) * 10 })) });
      toast('카테고리 순서를 저장했습니다.', 'ok');
      await reloadServices();
      void load();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const save = async () => {
    if (!edit) return;
    try {
      await api('admin.categories.save', edit);
      toast('저장했습니다.', 'ok');
      setEdit(null);
      await reloadServices();
      void load();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  return (
    <>
      <div className="page-head">
        <div><h1>서비스 카테고리</h1><p>카테고리는 사용자 대시보드의 필터·그룹으로 자동 사용됩니다. 삭제하면 소속 서비스는 “기타”로 이동합니다.</p></div>
        <div className="row">
          {dirty && <button className="btn" onClick={() => void saveOrder()}>순서 저장</button>}
          <button className="btn" onClick={() => setEdit({ categoryName: '', icon: 'folder', color: '#2563EB', isActive: true })}><Icon name="add" /> 카테고리 추가</button>
        </div>
      </div>
      <div className="panel">
        {!list ? <Loading /> : (
          <ul className="drag-list" aria-label="카테고리 순서">
            {list.map((c, i) => (
              <li key={c.categoryId} className={`drag-item${drag === c.categoryId ? ' dragging' : ''}`} draggable onDragStart={() => setDrag(c.categoryId)} onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (drag) move(list.findIndex((x) => x.categoryId === drag), i); setDrag(null); }}>
                <span className="drag-handle" aria-hidden><Icon name="drag_indicator" /></span>
                <span className="svc-dot" style={{ background: c.color }}><Icon name={c.icon} /></span>
                <div className="grow"><strong>{c.categoryName}</strong> {c.isActive === false && <Badge>숨김</Badge>}<div className="small muted">{c.categoryId} · 서비스 {c.serviceCount ?? 0}개{c.description ? ' · ' + c.description : ''}</div></div>
                <button className="icon-btn small" aria-label={`${c.categoryName} 위로`} onClick={() => move(i, i - 1)}><Icon name="arrow_upward" /></button>
                <button className="icon-btn small" aria-label={`${c.categoryName} 아래로`} onClick={() => move(i, i + 1)}><Icon name="arrow_downward" /></button>
                <button className="icon-btn small" aria-label={`${c.categoryName} 수정`} onClick={() => setEdit(c)}><Icon name="edit" /></button>
                {c.categoryId !== 'etc' && <button className="icon-btn small" aria-label={`${c.categoryName} 삭제`} onClick={() => setDel(c)}><Icon name="delete" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {edit && (
        <Modal title={edit.categoryId ? '카테고리 수정' : '카테고리 추가'} onClose={() => setEdit(null)} footer={<><button className="btn secondary" onClick={() => setEdit(null)}>취소</button><button className="btn" disabled={!edit.categoryName?.trim()} onClick={() => void save()}>저장</button></>}>
          <div className="stack">
            <TextField label="카테고리 이름" required value={edit.categoryName || ''} onChange={(v) => setEdit({ ...edit, categoryName: v })} maxLength={40} />
            {!edit.categoryId && <TextField label="카테고리 ID (선택)" value={edit.newCategoryId || ''} onChange={(v) => setEdit({ ...edit, newCategoryId: v })} hint="영문 소문자·숫자·하이픈. 비우면 자동 생성" />}
            <TextField label="설명" value={edit.description || ''} onChange={(v) => setEdit({ ...edit, description: v })} maxLength={200} />
            <div className="form-grid">
              <TextField label="아이콘 (Material Symbols)" value={edit.icon || ''} onChange={(v) => setEdit({ ...edit, icon: v })} />
              <div className="field"><label className="label" htmlFor="cat-color">색상</label><input id="cat-color" type="color" value={edit.color || '#2563EB'} onChange={(e) => setEdit({ ...edit, color: e.target.value.toUpperCase() })} /></div>
            </div>
            <Check label="사용자 화면에 표시" checked={edit.isActive !== false} onChange={(v) => setEdit({ ...edit, isActive: v })} />
          </div>
        </Modal>
      )}
      {del && (
        <ConfirmDialog title="카테고리 삭제" danger confirmLabel="삭제" message={<p>“{del.categoryName}” 을(를) 삭제합니다. 소속 서비스 {del.serviceCount ?? 0}개는 “기타” 카테고리로 이동합니다.</p>}
          onConfirm={async () => { await api('admin.categories.delete', { categoryId: del.categoryId }); toast('삭제했습니다.', 'ok'); await reloadServices(); void load(); }}
          onClose={() => setDel(null)} />
      )}
    </>
  );
}

/* ───────────── 화면 구성 관리 + PC/태블릿/모바일 미리보기 ───────────── */

const DEVICES = [
  { key: 'pc', label: 'PC', icon: 'desktop_windows', width: 1280 },
  { key: 'tablet', label: '태블릿', icon: 'tablet', width: 820 },
  { key: 'mobile', label: '모바일', icon: 'smartphone', width: 390 },
] as const;

function toPreviewCard(s: AdminService, i: number): ServiceCard {
  const state = s.effectiveStatus === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE';
  return {
    serviceId: s.serviceId, serviceName: s.serviceName, englishName: s.englishName, icon: s.icon, primaryColor: s.primaryColor, backgroundColor: s.backgroundColor,
    categoryId: s.categoryId, sortOrder: i, isPinned: s.isPinned, state, canLaunch: state === 'AVAILABLE', description: s.description, keywords: s.keywords,
    serviceType: s.serviceType, thumbnailUrl: s.thumbnailUrl, cardStyle: s.cardStyle, isNew: i === 0, maintenanceMessage: s.maintenanceMessage,
  };
}

function sampleCards(n: number): ServiceCard[] {
  const icons = ['work', 'groups', 'rocket_launch', 'fact_check', 'school', 'smart_toy', 'science', 'insights'];
  const colors = ['#4285F4', '#0F9D58', '#E37400', '#9334E6', '#D93025', '#00897B'];
  return Array.from({ length: n }, (_, i) => ({
    serviceId: `sample-${i}`, serviceName: `예시 업무 서비스 ${i + 1}`, englishName: '', icon: icons[i % icons.length], primaryColor: colors[i % colors.length],
    categoryId: 'etc', sortOrder: i, isPinned: false, state: 'AVAILABLE', canLaunch: true, description: '미리보기용 예시 서비스입니다.',
  }));
}

export function UiSettingsPage() {
  const { services, categories, rev } = useAdmin();
  const { user } = useAuth();
  const toast = useToast();
  const [saved, setSaved] = useState<UiSettings | null>(null);
  const [ui, setUi] = useState<UiSettings | null>(null);
  const [device, setDevice] = useState<(typeof DEVICES)[number]['key']>('pc');
  const [sample, setSample] = useState<'real' | number>('real');
  const [history, setHistory] = useState<{ logId: string; timestamp: number; adminUsername: string; changeSummary: string }[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ ui: UiSettings }>('admin.settings.get').then((r) => { setSaved(r.ui); setUi(r.ui); }).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (rev && saved && ui && JSON.stringify(saved) === JSON.stringify(ui)) void load(); }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = useMemo(() => sample === 'real'
    ? services.filter((s) => ['ACTIVE', 'MAINTENANCE', 'DRAFT', 'SCHEDULED'].includes(s.effectiveStatus)).map(toPreviewCard)
    : sampleCards(sample), [services, sample]);
  if (!ui || !saved) return <Loading />;
  const set = <K extends keyof UiSettings>(k: K, v: UiSettings[K]) => setUi({ ...ui, [k]: v });
  const dirty = JSON.stringify(ui) !== JSON.stringify(saved);
  const dev = DEVICES.find((d) => d.key === device)!;
  const scale = Math.min(1, 860 / dev.width);

  const save = async (reset = false) => {
    setBusy(true);
    try {
      const r = await api<{ ui: UiSettings }>('admin.ui.save', reset ? { reset: true, baseVersion: saved.version } : { ui, baseVersion: saved.version });
      setSaved(r.ui);
      setUi(r.ui);
      toast(reset ? '기본 디자인으로 복원했습니다.' : '화면 구성을 저장했습니다. 모든 사용자 화면에 즉시 반영됩니다.', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
      if (e instanceof ApiError && e.code === 'CONFLICT') void load();
    } finally { setBusy(false); }
  };
  const bools: [keyof UiSettings, string][] = [
    ['showWelcomeMessage', '환영 문구'], ['showServiceCount', '서비스 개수'], ['showAvailableCount', '이용 가능 개수'], ['showCategories', '카테고리 필터'],
    ['showSearch', '검색창'], ['showFavorites', '즐겨찾기'], ['showRecentServices', '최근 사용 서비스'], ['showNewServices', '신규 서비스 영역'],
    ['showAnnouncements', '공지사항'], ['showServiceDescription', '서비스 설명'], ['showServiceStatus', '상태 배지'], ['showLastAccess', '최근 접속 시각'], ['showLaunchButton', '접속 버튼'],
  ];
  const num = (v: string) => Number(v) || 0;
  return (
    <>
      <div className="page-head">
        <div><h1>화면 구성 관리</h1><p>코드 수정 없이 사용자 대시보드 구성을 바꿉니다. 미리보기는 실제 대시보드와 같은 컴포넌트로 그려집니다.</p></div>
        <div className="row">
          <button className="btn secondary" onClick={() => api<{ items: typeof history }>('admin.ui.history').then((r) => setHistory(r.items)).catch((e) => toast(errorText(e), 'error'))}><Icon name="history" /> 변경 이력</button>
          <button className="btn secondary" onClick={() => setConfirmReset(true)}><Icon name="restart_alt" /> 기본 디자인 복원</button>
          <button className="btn secondary" disabled={!dirty} onClick={() => setUi(saved)}>되돌리기</button>
          <button className="btn" disabled={!dirty || busy} onClick={() => void save()}>{busy && <Spinner small />} 저장</button>
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="panel stack">
          <SelectField label="레이아웃" value={ui.layoutMode} onChange={(v) => set('layoutMode', v)} options={[
            { value: 'auto', label: '자동 (서비스 수·화면 너비 기준, 권장)' }, { value: 'grid2', label: '2열 그리드' }, { value: 'grid3', label: '3열 그리드' },
            { value: 'grid4', label: '4열 그리드' }, { value: 'list', label: '목록형' }, { value: 'compact', label: '컴팩트 타일' }, { value: 'grouped', label: '카테고리 그룹' },
          ]} />
          <div className="form-grid">
            <TextField label="PC 열 수 (0=자동)" type="number" min="0" max="6" value={String(ui.desktopColumns)} onChange={(v) => set('desktopColumns', num(v))} />
            <TextField label="태블릿 열 수 (0=자동)" type="number" min="0" max="4" value={String(ui.tabletColumns)} onChange={(v) => set('tabletColumns', num(v))} />
            <TextField label="모바일 열 수" type="number" min="1" max="2" value={String(ui.mobileColumns)} onChange={(v) => set('mobileColumns', Math.max(1, num(v)))} />
            <TextField label="페이지당 서비스 수" type="number" min="6" max="100" value={String(ui.pageSize)} onChange={(v) => set('pageSize', num(v))} />
          </div>
          <SelectField label="카드 크기" value={ui.cardSize} onChange={(v) => set('cardSize', v)} options={[{ value: 'large', label: '크게' }, { value: 'default', label: '기본' }, { value: 'small', label: '작게' }, { value: 'compact', label: '아주 작게' }]} />
          <SelectField label="기본 카드 스타일" value={ui.defaultCardStyle} onChange={(v) => set('defaultCardStyle', v)} options={[
            { value: 'default', label: '기본형' }, { value: 'icon', label: '아이콘 강조형' }, { value: 'thumbnail', label: '썸네일형' }, { value: 'list', label: '목록형' }, { value: 'color', label: '색상 강조형' },
          ]} />
          <SelectField label="기본 정렬" value={ui.defaultSortOrder} onChange={(v) => set('defaultSortOrder', v)} options={[{ value: 'manual', label: '관리자 지정 순서' }, { value: 'name', label: '이름순' }, { value: 'recent', label: '최근 사용순' }]} />
          <div>
            <div className="label" style={{ fontWeight: 500, marginBottom: 4 }}>표시 항목</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 2 }}>
              {bools.map(([k, label]) => <Check key={k} label={label} checked={!!ui[k]} onChange={(v) => set(k, v as never)} />)}
            </div>
          </div>
          {saved.updatedAt && <div className="small muted">최종 저장 {fmtDateTime(saved.updatedAt)} · 버전 {saved.version}</div>}
        </div>
        <div className="panel">
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="seg" role="tablist" aria-label="미리보기 기기">
              {DEVICES.map((d) => <button key={d.key} role="tab" aria-selected={device === d.key} className={`btn small ${device === d.key ? 'navy' : 'secondary'}`} onClick={() => setDevice(d.key)}><Icon name={d.icon} /> {d.label} ({d.width}px)</button>)}
            </div>
            <select className="input" style={{ width: 'auto' }} aria-label="미리보기 데이터" value={String(sample)} onChange={(e) => setSample(e.target.value === 'real' ? 'real' : Number(e.target.value))}>
              <option value="real">실제 서비스 ({services.length}개, 초안 포함)</option>
              {[0, 1, 2, 3, 4, 6, 10, 20, 50].map((n) => <option key={n} value={n}>예시 서비스 {n}개</option>)}
            </select>
            {dirty && <Badge kind="warn">저장하지 않은 변경</Badge>}
          </div>
          <div className="preview-frame" style={{ height: 640, overflow: 'auto', padding: 0 }}>
            <div style={{ width: dev.width, transform: `scale(${scale})`, transformOrigin: 'top left', padding: 16, background: 'var(--bg)' }}>
              <DashboardView preview supportContact="" onLaunch={() => undefined}
                data={{
                  services: cards, categories, ui, announcements: [], prefs: { favoriteServices: [], recentServices: [], theme: 'light', language: 'ko' },
                  counts: { visible: cards.length, available: cards.filter((c) => c.state === 'AVAILABLE').length, maintenance: cards.filter((c) => c.state === 'MAINTENANCE').length, locked: 0 },
                  user: user || undefined,
                }} />
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>미리보기 배율 {Math.round(scale * 100)}%. 실제 화면에서는 사용자별 권한에 맞는 서비스만 표시됩니다.</p>
        </div>
      </div>
      {confirmReset && <ConfirmDialog title="기본 디자인 복원" confirmLabel="복원" message={<p>화면 구성을 기본값으로 되돌립니다. 현재 설정은 변경 이력에 남아 다시 복원할 수 있습니다.</p>} onConfirm={() => save(true)} onClose={() => setConfirmReset(false)} />}
      {history && (
        <Modal title="화면 구성 변경 이력" onClose={() => setHistory(null)} size="wide">
          {history.length === 0 ? <Empty title="변경 이력이 없습니다." /> : (
            <div className="table-wrap"><table className="table"><tbody>
              {history.map((h) => (
                <tr key={h.logId}><td className="small nowrap">{fmtDateTime(h.timestamp)}</td><td className="small">{h.adminUsername}</td><td className="small">{h.changeSummary}</td>
                  <td><button className="btn small secondary" onClick={async () => { try { const r = await api<{ ui: UiSettings }>('admin.ui.restore', { logId: h.logId }); setSaved(r.ui); setUi(r.ui); setHistory(null); toast('이 변경 이전 상태로 복원했습니다.', 'ok'); } catch (e) { toast(errorText(e), 'error'); } }}>이전 상태로 복원</button></td></tr>
              ))}
            </tbody></table></div>
          )}
        </Modal>
      )}
    </>
  );
}

/* ───────────── 공지사항 ───────────── */

const emptyAnn: Announcement = { announcementId: '', title: '', content: '', category: 'GENERAL', priority: 'NORMAL', targetRoles: [], targetServices: [], isActive: true, startDate: todayKey(), endDate: '' };

export function AnnouncementsPage() {
  const { services, rev } = useAdmin();
  const toast = useToast();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [edit, setEdit] = useState<Announcement | null>(null);
  const [del, setDel] = useState<Announcement | null>(null);
  const load = useCallback(() => api<{ items: Announcement[] }>('admin.announcements.list').then((r) => setItems(r.items)).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => { void load(); }, [load, rev]);
  const save = async () => {
    if (!edit) return;
    try {
      await api('admin.announcements.save', { ...edit });
      toast('공지사항을 저장했습니다.', 'ok');
      setEdit(null);
      void load();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const today = todayKey();
  return (
    <>
      <div className="page-head">
        <div><h1>공지사항 관리</h1><p>게시 기간·대상 역할·대상 서비스를 지정할 수 있습니다. 중요 공지는 대시보드 상단에 표시됩니다.</p></div>
        <button className="btn" onClick={() => setEdit({ ...emptyAnn })}><Icon name="add" /> 공지 작성</button>
      </div>
      <div className="panel">
        {!items ? <Loading /> : items.length === 0 ? <Empty icon="campaign" title="등록된 공지사항이 없습니다." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>제목</th><th>분류</th><th>게시 기간</th><th>대상</th><th>상태</th><th>작성</th><th></th></tr></thead><tbody>
            {items.map((a) => {
              const live = a.isActive !== false && (!a.startDate || a.startDate <= today) && (!a.endDate || a.endDate >= today);
              return (
                <tr key={a.announcementId}>
                  <td><strong>{a.title}</strong> {a.priority === 'HIGH' && <Badge kind="err">중요</Badge>}</td>
                  <td className="small">{ANNOUNCEMENT_CATEGORY_LABEL[a.category]}</td>
                  <td className="small nowrap">{fmtDateStr(a.startDate) || '즉시'} ~ {fmtDateStr(a.endDate) || '제한 없음'}</td>
                  <td className="small">{a.targetRoles?.length ? a.targetRoles.map((r) => ROLE_LABEL[r]).join(', ') : '전체'}{a.targetServices?.length ? ` · 서비스 ${a.targetServices.length}개` : ''}</td>
                  <td><Badge kind={live ? 'ok' : undefined}>{live ? '게시 중' : a.isActive === false ? '비활성' : '기간 외'}</Badge></td>
                  <td className="small nowrap">{a.createdByName}<div className="muted">{fmtDateTime(a.createdAt)}</div></td>
                  <td className="nowrap"><button className="icon-btn small" aria-label={`${a.title} 수정`} onClick={() => setEdit({ ...emptyAnn, ...a })}><Icon name="edit" /></button><button className="icon-btn small" aria-label={`${a.title} 삭제`} onClick={() => setDel(a)}><Icon name="delete" /></button></td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
      </div>
      {edit && (
        <Modal title={edit.announcementId ? '공지 수정' : '공지 작성'} size="wide" onClose={() => setEdit(null)} footer={<><button className="btn secondary" onClick={() => setEdit(null)}>취소</button><button className="btn" disabled={!edit.title.trim() || !edit.content.trim()} onClick={() => void save()}>저장</button></>}>
          <div className="stack">
            <TextField label="제목" required value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} maxLength={100} />
            <TextArea label="내용" value={edit.content} onChange={(v) => setEdit({ ...edit, content: v })} rows={8} maxLength={5000} hint="HTML 은 표시되지 않고 일반 텍스트로 출력됩니다." />
            <div className="form-grid">
              <SelectField label="분류" value={edit.category} onChange={(v) => setEdit({ ...edit, category: v })} options={Object.entries(ANNOUNCEMENT_CATEGORY_LABEL).map(([value, label]) => ({ value: value as Announcement['category'], label }))} />
              <SelectField label="중요도" value={edit.priority} onChange={(v) => setEdit({ ...edit, priority: v })} options={[{ value: 'NORMAL', label: '일반' }, { value: 'HIGH', label: '중요 (상단 표시)' }]} />
              <TextField label="게시 시작일" type="date" value={edit.startDate || ''} onChange={(v) => setEdit({ ...edit, startDate: v })} />
              <TextField label="게시 종료일" type="date" value={edit.endDate || ''} onChange={(v) => setEdit({ ...edit, endDate: v })} />
            </div>
            <div><div className="label" style={{ fontWeight: 500 }}>대상 역할 (선택하지 않으면 전체)</div>
              <div className="row">{(['USER', 'ADMIN', 'SUPER_ADMIN'] as Role[]).map((r) => <Check key={r} label={ROLE_LABEL[r]} checked={!!edit.targetRoles?.includes(r)} onChange={(on) => setEdit({ ...edit, targetRoles: on ? [...(edit.targetRoles || []), r] : (edit.targetRoles || []).filter((x) => x !== r) })} />)}</div></div>
            <div><div className="label" style={{ fontWeight: 500 }}>대상 서비스 권한자 (선택하지 않으면 전체)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>{services.map((s) => <Check key={s.serviceId} label={s.serviceName} checked={!!edit.targetServices?.includes(s.serviceId)} onChange={(on) => setEdit({ ...edit, targetServices: on ? [...(edit.targetServices || []), s.serviceId] : (edit.targetServices || []).filter((x) => x !== s.serviceId) })} />)}</div></div>
            <Check label="게시 (활성)" checked={edit.isActive !== false} onChange={(v) => setEdit({ ...edit, isActive: v })} />
          </div>
        </Modal>
      )}
      {del && <ConfirmDialog title="공지 삭제" danger confirmLabel="삭제" message={<p>“{del.title}” 공지를 삭제합니다.</p>} onConfirm={async () => { await api('admin.announcements.delete', { announcementId: del.announcementId }); toast('삭제했습니다.', 'ok'); void load(); }} onClose={() => setDel(null)} />}
    </>
  );
}

/* ───────────── 시스템 설정 ───────────── */

const SECURITY_KEYS: (keyof PlatformSettings)[] = ['sessionTimeout', 'maximumSessionDuration', 'passwordMinLength', 'loginMaxAttempts', 'loginLockMinutes', 'allowedServiceDomains', 'ssoCodeTtlSeconds'];

export function SettingsPage() {
  const toast = useToast();
  const [saved, setSaved] = useState<PlatformSettings | null>(null);
  const [s, setS] = useState<PlatformSettings | null>(null);
  const [domains, setDomains] = useState('');
  const [reauth, setReauth] = useState('');
  const [busy, setBusy] = useState(false);
  const [system, setSystem] = useState<{ bootstrappedAt: number | null } | null>(null);
  const load = useCallback(() => api<{ settings: PlatformSettings; system: { bootstrappedAt: number | null } }>('admin.settings.get').then((r) => { setSaved(r.settings); setS(r.settings); setDomains(r.settings.allowedServiceDomains.join('\n')); setSystem(r.system); }).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => { void load(); }, [load]);
  if (!s || !saved) return <Loading />;
  const next = { ...s, allowedServiceDomains: domains.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean) };
  const changed = (Object.keys(next) as (keyof PlatformSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(saved[k]));
  const needReauth = changed.some((k) => SECURITY_KEYS.includes(k));
  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      const patch = Object.fromEntries(changed.map((k) => [k, next[k]]));
      await api('admin.settings.save', { settings: patch, baseVersion: saved.version, reauthPassword: needReauth ? reauth : undefined });
      toast('시스템 설정을 저장했습니다.', 'ok');
      setReauth('');
      void load();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const n = (v: string) => Number(v) || 0;
  return (
    <>
      <div className="page-head">
        <div><h1>시스템 설정</h1><p>보안 관련 항목(세션·비밀번호·잠금·허용 도메인·SSO) 변경 시 관리자 재인증이 필요합니다.</p></div>
        <button className="btn" disabled={!changed.length || busy || (needReauth && !reauth)} onClick={() => void save()}>{busy && <Spinner small />} 저장 ({changed.length})</button>
      </div>
      {needReauth && <div className="panel" style={{ marginBottom: 16 }}><PasswordField label="관리자 재인증 (보안 설정 변경)" value={reauth} onChange={setReauth} autoComplete="current-password" /></div>}
      <div className="grid-2">
        <div className="panel stack">
          <h3>플랫폼 정보</h3>
          <TextField label="플랫폼 이름" value={s.platformName} onChange={(v) => set('platformName', v)} />
          <TextField label="영문 이름" value={s.platformNameEn} onChange={(v) => set('platformNameEn', v)} />
          <TextField label="대표 접속 URL" value={s.portalUrl} onChange={(v) => set('portalUrl', v)} hint="예: https://profcys.web.app — QR 코드·SSO 안내에 사용" inputMode="url" />
          <TextArea label="문의처 (로그인 화면·오류 화면 표시)" value={s.supportContact} onChange={(v) => set('supportContact', v)} rows={2} />
          <TextField label="저작권 문구" value={s.copyright} onChange={(v) => set('copyright', v)} />
          <h3>운영</h3>
          <Check label="플랫폼 점검 모드 (최고관리자 외 로그인 차단)" checked={s.maintenanceMode} onChange={(v) => set('maintenanceMode', v)} />
          <TextArea label="점검 안내 문구" value={s.maintenanceMessage} onChange={(v) => set('maintenanceMessage', v)} rows={2} />
          <Check label="권한 없는 서비스도 잠금 카드로 표시 (URL·상세 정보는 표시하지 않음)" checked={s.showRestrictedServices} onChange={(v) => set('showRestrictedServices', v)} />
          <TextField label="NEW 배지 표시 기간 (일)" type="number" value={String(s.newBadgeDays)} onChange={(v) => set('newBadgeDays', n(v))} />
          <TextField label="접속 기록 보관 기간 (일)" type="number" value={String(s.logRetentionDays)} onChange={(v) => set('logRetentionDays', n(v))} hint="Firestore TTL 정책 또는 정리 트리거로 삭제" />
          <Check label="자체 회원가입 (명세상 비활성 고정)" checked={false} disabled onChange={() => undefined} />
        </div>
        <div className="panel stack">
          <h3>보안</h3>
          <div className="form-grid">
            <TextField label="미사용 자동 로그아웃 (분)" type="number" value={String(s.sessionTimeout)} onChange={(v) => set('sessionTimeout', n(v))} />
            <TextField label="로그아웃 사전 안내 (분)" type="number" value={String(s.sessionWarningMinutes)} onChange={(v) => set('sessionWarningMinutes', n(v))} />
            <TextField label="최대 세션 유지 (시간)" type="number" value={String(s.maximumSessionDuration)} onChange={(v) => set('maximumSessionDuration', n(v))} />
            <TextField label="비밀번호 최소 길이" type="number" value={String(s.passwordMinLength)} onChange={(v) => set('passwordMinLength', n(v))} />
            <TextField label="로그인 실패 허용 횟수" type="number" value={String(s.loginMaxAttempts)} onChange={(v) => set('loginMaxAttempts', n(v))} />
            <TextField label="계정 잠금 시간 (분)" type="number" value={String(s.loginLockMinutes)} onChange={(v) => set('loginLockMinutes', n(v))} />
            <TextField label="SSO 인증 코드 유효 (초)" type="number" value={String(s.ssoCodeTtlSeconds)} onChange={(v) => set('ssoCodeTtlSeconds', n(v))} hint="15~120초, 1회용" />
          </div>
          <TextArea label="허용 서비스 도메인 (한 줄에 하나)" value={domains} onChange={setDomains} rows={10} hint="여기에 없는 도메인의 URL 은 등록·공개할 수 없습니다. 하위 도메인은 자동 포함됩니다." />
          {system?.bootstrappedAt && <div className="small muted">최초 설정 완료: {fmtDateTime(system.bootstrappedAt)}</div>}
        </div>
      </div>
    </>
  );
}

/* ───────────── 백업·복원 ───────────── */

export function BackupPage() {
  const toast = useToast();
  const { reloadServices } = useAdmin();
  const [file, setFile] = useState<{ name: string; data: Record<string, unknown> & { meta?: { exportedAt?: number; exportedBy?: string } } } | null>(null);
  const [scope, setScope] = useState({ services: true, categories: true, announcements: true, ui: true, settings: false });
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const exportJson = async () => {
    try {
      const r = await api<Record<string, unknown>>('admin.backup.export');
      downloadText(`profcys-backup-${todayKey()}.json`, JSON.stringify(r, null, 2), 'application/json');
      toast('백업 파일을 내려받았습니다. 비밀번호·세션·인증 키는 포함되지 않습니다.', 'ok');
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const onFile = async (f: File) => {
    try {
      const data = JSON.parse((await f.text()).replace(/^\uFEFF/, ''));
      if (data?.meta?.platform !== 'profcys-gateway') throw new Error('PROFCYS 백업 파일이 아닙니다.');
      setFile({ name: f.name, data });
    } catch (e) { toast((e as Error).message || '파일을 읽지 못했습니다.', 'error'); }
  };
  const count = (k: string) => (Array.isArray(file?.data[k]) ? (file!.data[k] as unknown[]).length : 0);
  return (
    <>
      <div className="page-head"><div><h1>데이터 백업 및 내보내기</h1><p>정기 백업은 Apps Script 편집기의 exportBackupToSheet 함수(시간 트리거)로도 실행할 수 있습니다.</p></div></div>
      <div className="grid-2">
        <div className="panel stack">
          <h3><Icon name="download" /> 백업 내보내기</h3>
          <p className="small">사용자(비밀번호 제외)·서비스·카테고리·공지·설정·화면 구성을 JSON 으로 내려받습니다. 비밀번호, 인증용 이메일, 세션, 인증 코드, 서비스 키는 포함되지 않습니다.</p>
          <Alert kind="warn">백업 파일에는 사용자 개인정보(이름·소속·연락처)가 포함됩니다. 안전한 장소에 보관하세요.</Alert>
          <button className="btn" onClick={() => void exportJson()}><Icon name="download" /> JSON 백업 내려받기</button>
        </div>
        <div className="panel stack">
          <h3><Icon name="upload" /> 백업 복원</h3>
          <p className="small">서비스·카테고리·공지·화면 구성·설정을 복원합니다. <strong>사용자 계정과 권한은 복원하지 않습니다.</strong> 복원되는 서비스의 접근 정책·공개 상태·보안 검증 상태는 현재 값을 유지하며(신규 서비스는 초안), URL 은 현재 허용 도메인 정책으로 다시 검증합니다. 영구 삭제된 서비스 ID 는 복원되지 않습니다.</p>
          <input type="file" accept="application/json,.json" aria-label="백업 파일 선택" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          {file && (
            <>
              <div className="small">{file.name} · {fmtDateTime(file.data.meta?.exportedAt)} · {file.data.meta?.exportedBy}</div>
              <Check label={`서비스 (${count('services')})`} checked={scope.services} onChange={(v) => setScope({ ...scope, services: v })} />
              <Check label={`카테고리 (${count('categories')})`} checked={scope.categories} onChange={(v) => setScope({ ...scope, categories: v })} />
              <Check label={`공지사항 (${count('announcements')})`} checked={scope.announcements} onChange={(v) => setScope({ ...scope, announcements: v })} />
              <Check label="화면 구성" checked={scope.ui} onChange={(v) => setScope({ ...scope, ui: v })} />
              <Check label="시스템 설정 (보안 설정 포함)" checked={scope.settings} onChange={(v) => setScope({ ...scope, settings: v })} />
              <button className="btn danger" onClick={() => setConfirm(true)}>복원 실행</button>
            </>
          )}
          {report && <Alert kind="ok"><pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(report, null, 2)}</pre></Alert>}
        </div>
      </div>
      {confirm && file && (
        <ConfirmDialog title="백업 복원" danger requirePassword confirmLabel="복원" message={<p>선택한 항목을 백업 내용으로 덮어씁니다. 복원 전에 현재 상태를 먼저 백업해 두기를 권장합니다.</p>}
          onConfirm={async (pw) => { const r = await api<{ report: Record<string, unknown> }>('admin.backup.restore', { data: file.data, scope, reauthPassword: pw }); setReport(r.report); toast('복원했습니다.', 'ok'); await reloadServices(); }}
          onClose={() => setConfirm(false)} />
      )}
    </>
  );
}

/* ───────────── 접속 QR 코드 ───────────── */

export function QrPage() {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [svg, setSvg] = useState('');
  const [png, setPng] = useState('');
  useEffect(() => {
    api<{ settings?: PlatformSettings }>('admin.settings.get').then((r) => setUrl(r.settings?.portalUrl || window.location.origin)).catch(() => setUrl(window.location.origin));
  }, []);
  useEffect(() => {
    if (!/^https?:\/\//.test(url)) { setSvg(''); setPng(''); return; }
    QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#102B50', light: '#FFFFFF' } }).then(setSvg).catch(() => setSvg(''));
    QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#102B50', light: '#FFFFFF' } }).then(setPng).catch(() => setPng(''));
  }, [url]);
  return (
    <>
      <div className="page-head"><div><h1>접속 QR 코드</h1><p>스마트폰 카메라로 촬영하면 PROFCYS 로그인 화면으로 이동합니다. QR 에는 인증 정보가 포함되지 않습니다.</p></div></div>
      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="stack">
          <TextField label="접속 주소" value={url} onChange={setUrl} inputMode="url" hint="기본값은 시스템 설정의 대표 접속 URL 입니다." />
          {url.startsWith('http://') && !url.startsWith('http://localhost') && <Alert kind="warn">운영 환경에서는 https:// 주소를 사용하세요.</Alert>}
          {svg ? <div className="qr-box" style={{ width: 280, margin: '0 auto' }} role="img" aria-label={`${url} 접속 QR 코드`} dangerouslySetInnerHTML={{ __html: svg }} /> : <Empty icon="qr_code_2" title="올바른 주소를 입력하세요." />}
          <div className="center mono small">{url}</div>
          <div className="row" style={{ justifyContent: 'center' }}>
            {png && <a className="btn secondary" href={png} download="profcys-qr.png"><Icon name="image" /> PNG 저장</a>}
            {svg && <button className="btn secondary" onClick={() => downloadText('profcys-qr.svg', svg, 'image/svg+xml')}><Icon name="draw" /> SVG 저장</button>}
            <button className="btn secondary" onClick={() => window.print()}><Icon name="print" /> 인쇄</button>
            <button className="btn secondary" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => undefined); toast('주소를 복사했습니다.', 'ok'); }}><Icon name="content_copy" /> 주소 복사</button>
          </div>
        </div>
      </div>
    </>
  );
}
