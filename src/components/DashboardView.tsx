/**
 * 사용자 대시보드 본문 (18·19장) — 실제 대시보드와 관리자 "실시간 미리보기"가 같은 컴포넌트를 사용한다.
 * 서비스 수·카테고리·검색·필터·레이아웃이 모두 데이터와 컨테이너 너비로부터 자동 구성된다.
 */
import { useMemo, useState } from 'react';
import type { Announcement, Category, DashboardData, ServiceCard, UiSettings } from '../types';
import { computeLayout } from '../utils/layout';
import { useElementWidth } from '../hooks/useElementWidth';
import { DynamicServiceCard, displayFromUi } from './DynamicServiceCard';
import { Alert, Badge, Empty, Icon, Modal, Pagination } from './ui';
import { ANNOUNCEMENT_CATEGORY_LABEL, fmtDate, fmtDateTime, ROLE_LABEL, SERVICE_TYPE_LABEL } from '../utils/format';

export type FilterKey = 'all' | 'favorites' | 'recent' | 'new' | 'available' | `cat:${string}`;

export interface DashboardViewProps {
  data: Pick<DashboardData, 'services' | 'categories' | 'ui' | 'announcements' | 'counts' | 'prefs'> & { user?: DashboardData['user']; platform?: DashboardData['platform'] };
  onLaunch: (s: ServiceCard) => void;
  onToggleFavorite?: (s: ServiceCard) => void;
  busyId?: string | null;
  preview?: boolean;
  supportContact?: string;
}

function matchesSearch(s: ServiceCard, q: string, categories: Category[], typeLabel: (t?: string) => string) {
  if (!q) return true;
  const cat = categories.find((c) => c.categoryId === s.categoryId)?.categoryName || '';
  const hay = [s.serviceName, s.englishName, s.description, cat, ...(s.keywords || []), typeLabel(s.serviceType)].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const typeLabel = (t?: string) => (t ? SERVICE_TYPE_LABEL[t] || t : '');

function sortServices(list: ServiceCard[], ui: UiSettings) {
  const copy = list.slice();
  if (ui.defaultSortOrder === 'name') copy.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || a.serviceName.localeCompare(b.serviceName, 'ko'));
  else if (ui.defaultSortOrder === 'recent') copy.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || (b.lastAccessAt || 0) - (a.lastAccessAt || 0));
  return copy; // manual: 서버가 고정→표시순서로 정렬해 보냄
}

export function DashboardView({ data, onLaunch, onToggleFavorite, busyId, preview, supportContact }: DashboardViewProps) {
  const { ui, services, categories, announcements, counts, prefs } = data;
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const [openAnn, setOpenAnn] = useState<Announcement | null>(null);

  const catName = useMemo(() => Object.fromEntries(categories.map((c) => [c.categoryId, c.categoryName])), [categories]);
  const recentIds = useMemo(() => (prefs.recentServices || []).map((r) => r.serviceId), [prefs.recentServices]);

  const filtered = useMemo(() => {
    let list = services.filter((s) => matchesSearch(s, query, categories, typeLabel));
    if (filter === 'favorites') list = list.filter((s) => s.favorite);
    else if (filter === 'recent') list = recentIds.map((id) => list.find((s) => s.serviceId === id)).filter(Boolean) as ServiceCard[];
    else if (filter === 'new') list = list.filter((s) => s.isNew);
    else if (filter === 'available') list = list.filter((s) => s.state === 'AVAILABLE');
    else if (filter.startsWith('cat:')) list = list.filter((s) => s.categoryId === filter.slice(4));
    return filter === 'recent' ? list : sortServices(list, ui);
  }, [services, query, filter, categories, recentIds, ui]);

  const layout = computeLayout(filtered.length, width, ui);
  const display = displayFromUi(ui, layout.variant);
  const pageCount = layout.paginate ? Math.ceil(filtered.length / layout.pageSize) : 1;
  const safePage = Math.min(page, Math.max(1, pageCount));
  const visible = layout.paginate ? filtered.slice((safePage - 1) * layout.pageSize, safePage * layout.pageSize) : filtered;
  const grouped = layout.grouped && filter === 'all' && !query;

  const favorites = services.filter((s) => s.favorite && s.state !== 'LOCKED');
  const recents = recentIds.map((id) => services.find((s) => s.serviceId === id)).filter((s): s is ServiceCard => !!s && s.state !== 'LOCKED').slice(0, 6);
  const newOnes = services.filter((s) => s.isNew && s.state === 'AVAILABLE');
  const important = announcements.filter((a) => a.priority === 'HIGH' || a.category === 'IMPORTANT' || a.category === 'MAINTENANCE' || a.category === 'SECURITY');
  const showChips = ui.showCategories && services.length > 0;
  const showHighlights = filter === 'all' && !query;

  const renderGrid = (list: ServiceCard[], keyPrefix = '') => {
    const l = computeLayout(list.length, width, ui);
    const cls = `service-grid${l.variant === 'list' ? ' list' : ''}${l.variant === 'compact' ? ' compact' : ''}${l.centered && list.length === 1 ? ' centered' : ''}`;
    return (
      <div className={cls} style={{ ['--cols' as string]: l.variant === 'list' ? 1 : l.columns }} data-columns={l.variant === 'list' ? 1 : l.columns} data-testid={keyPrefix ? undefined : 'service-grid'}>
        {list.map((s) => (
          <DynamicServiceCard key={keyPrefix + s.serviceId} service={s} display={{ ...display, variant: l.variant }} categoryName={catName[s.categoryId]} onLaunch={onLaunch} onToggleFavorite={onToggleFavorite} busy={busyId === s.serviceId} />
        ))}
      </div>
    );
  };

  return (
    <div ref={ref} data-device={layout.device} data-layout-columns={layout.columns}>
      {ui.showWelcomeMessage && data.user && (
        <div className="welcome">
          <div>
            <h1>{data.user.displayName}님, 안녕하세요.</h1>
            <div className="muted small">
              {ROLE_LABEL[data.user.role]}{data.user.organization ? ` · ${data.user.organization}` : ''}
              {data.user.previousLoginAt ? ` · 최근 로그인 ${fmtDateTime(data.user.previousLoginAt)}` : ''}
            </div>
          </div>
          {(ui.showServiceCount || ui.showAvailableCount) && (
            <div className="stat-pills">
              {ui.showServiceCount && <span className="stat-pill">표시 서비스 <strong>{counts.visible}</strong></span>}
              {ui.showAvailableCount && <span className="stat-pill">이용 가능 <strong>{counts.available}</strong></span>}
            </div>
          )}
        </div>
      )}

      {data.platform?.maintenanceMode && <Alert kind="warn" icon="construction">{data.platform.maintenanceMessage || '플랫폼 점검이 예정되어 있습니다.'}</Alert>}

      {ui.showAnnouncements && important.slice(0, 2).map((a) => (
        <div key={a.announcementId} className={`announce-bar${a.priority === 'HIGH' ? ' high' : ''}`} role="note">
          <Icon name={a.category === 'MAINTENANCE' ? 'construction' : a.category === 'SECURITY' ? 'shield' : 'campaign'} />
          <div className="grow">
            <strong>[{ANNOUNCEMENT_CATEGORY_LABEL[a.category]}] {a.title}</strong>
            <div className="small" style={{ whiteSpace: 'pre-line' }}>{a.content.length > 160 ? a.content.slice(0, 160) + '…' : a.content}</div>
          </div>
          <button type="button" className="btn small secondary" onClick={() => setOpenAnn(a)}>자세히</button>
        </div>
      ))}

      {(ui.showSearch || showChips) && services.length > 0 && (
        <div className="filters">
          {ui.showSearch && (
            <div className="search">
              <Icon name="search" />
              <input className="input" type="search" placeholder="서비스 이름, 설명, 키워드로 검색" aria-label="서비스 검색" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            </div>
          )}
          {showChips && (
            <div className="chips" role="toolbar" aria-label="서비스 필터">
              <Chip k="all" cur={filter} set={(f) => { setFilter(f); setPage(1); }} label="전체 서비스" count={services.length} />
              {ui.showFavorites && favorites.length > 0 && <Chip k="favorites" cur={filter} set={setFilter} label="즐겨찾기" icon="star" count={favorites.length} />}
              {ui.showRecentServices && recents.length > 0 && <Chip k="recent" cur={filter} set={setFilter} label="최근 이용" icon="history" />}
              {ui.showNewServices && newOnes.length > 0 && <Chip k="new" cur={filter} set={setFilter} label="신규" icon="fiber_new" count={newOnes.length} />}
              <Chip k="available" cur={filter} set={setFilter} label="이용 가능" icon="check_circle" count={counts.available} />
              {categories.map((c) => (
                <Chip key={c.categoryId} k={`cat:${c.categoryId}`} cur={filter} set={(f) => { setFilter(f); setPage(1); }} label={c.categoryName} icon={c.icon} count={c.serviceCount} />
              ))}
            </div>
          )}
        </div>
      )}

      {showHighlights && ui.showNewServices && newOnes.length > 0 && (
        <section aria-label="신규 서비스 안내">
          <div className="section-title"><Icon name="fiber_new" /> 신규 서비스</div>
          <div className="announce-list">
            {newOnes.slice(0, 3).map((s) => (
              <div key={'n' + s.serviceId} className="announce-item" style={{ cursor: 'default' }}>
                <Icon name={s.icon} />
                <div className="grow">
                  <strong>{s.serviceName}</strong> <span className="small muted">공개일 {fmtDate(s.publishedAt)}</span>
                  <div className="small muted">{s.description}</div>
                </div>
                <button type="button" className="btn small" onClick={() => onLaunch(s)} disabled={busyId === s.serviceId}>접속</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {showHighlights && ui.showFavorites && favorites.length > 0 && (
        <section aria-label="즐겨찾기 서비스">
          <div className="section-title"><Icon name="star" fill /> 즐겨찾기</div>
          {renderGrid(favorites, 'fav-')}
        </section>
      )}
      {showHighlights && ui.showRecentServices && recents.length > 0 && !preview && (
        <section aria-label="최근 이용 서비스">
          <div className="section-title"><Icon name="history" /> 최근 이용 서비스</div>
          {renderGrid(recents, 'rec-')}
        </section>
      )}

      <section aria-label="업무 서비스">
        <div className="section-title">
          <Icon name="apps" /> {filter === 'all' ? '업무 서비스' : filter.startsWith('cat:') ? catName[filter.slice(4)] : { favorites: '즐겨찾기', recent: '최근 이용', new: '신규 서비스', available: '이용 가능 서비스' }[filter as string]}
          {query && <span className="small muted">“{query}” 검색 결과 {filtered.length}건</span>}
        </div>

        {services.length === 0 ? (
          <div className="panel">
            <Empty icon="apps_outage" title="현재 이용 가능한 업무 서비스가 없습니다.">
              서비스 접근 권한이 필요하면 관리자에게 문의하세요.{supportContact ? <><br />{supportContact}</> : null}
            </Empty>
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel"><Empty icon="search_off" title="조건에 맞는 서비스가 없습니다." /></div>
        ) : grouped ? (
          categories.filter((c) => visible.some((s) => s.categoryId === c.categoryId)).map((c) => (
            <div key={c.categoryId} style={{ marginBottom: 18 }}>
              <h3 className="row" style={{ marginTop: 8 }}><Icon name={c.icon} /> {c.categoryName} <Badge>{visible.filter((s) => s.categoryId === c.categoryId).length}</Badge></h3>
              {renderGrid(visible.filter((s) => s.categoryId === c.categoryId), `g-${c.categoryId}-`)}
            </div>
          ))
        ) : (
          renderGrid(visible)
        )}
        {layout.paginate && <Pagination page={safePage} total={filtered.length} pageSize={layout.pageSize} onPage={setPage} />}
      </section>

      {ui.showAnnouncements && announcements.length > 0 && (
        <section aria-label="공지사항">
          <div className="section-title"><Icon name="campaign" /> 공지사항</div>
          <div className="announce-list">
            {announcements.slice(0, 5).map((a) => (
              <button key={a.announcementId} type="button" className="announce-item" onClick={() => setOpenAnn(a)}>
                <Badge kind={a.priority === 'HIGH' ? 'err' : 'info'}>{ANNOUNCEMENT_CATEGORY_LABEL[a.category]}</Badge>
                <span className="grow">{a.title}</span>
                <span className="small muted">{fmtDate(a.createdAt)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {openAnn && (
        <Modal title={openAnn.title} onClose={() => setOpenAnn(null)}>
          <div className="row" style={{ marginBottom: 10 }}>
            <Badge kind={openAnn.priority === 'HIGH' ? 'err' : 'info'}>{ANNOUNCEMENT_CATEGORY_LABEL[openAnn.category]}</Badge>
            <span className="small muted">{fmtDate(openAnn.createdAt)}{openAnn.endDate ? ` · 게시 종료 ${openAnn.endDate.replace(/-/g, '.')}` : ''}</span>
          </div>
          <div style={{ whiteSpace: 'pre-line' }}>{openAnn.content}</div>
        </Modal>
      )}
    </div>
  );
}

function Chip({ k, cur, set, label, icon, count }: { k: FilterKey; cur: FilterKey; set: (f: FilterKey) => void; label: string; icon?: string; count?: number }) {
  return (
    <button type="button" className="chip" aria-pressed={cur === k} onClick={() => set(k)}>
      {icon && <Icon name={icon} />} {label} {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}
