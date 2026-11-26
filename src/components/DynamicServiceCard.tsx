/**
 * DynamicServiceCard — 모든 서비스 카드를 그리는 단 하나의 재사용 컴포넌트 (18장)
 * 서비스별 카드 컴포넌트를 따로 작성하지 않는다. 모든 표시 정보는 서버(DB)에서 받은 서비스 데이터로 결정된다.
 */
import type { CSSProperties } from 'react';
import type { CardSize, CardStyle, ServiceCard, UiSettings } from '../types';
import { CARD_STATE_LABEL, fmtDateTime, relativeTime } from '../utils/format';
import { Badge, Icon } from './ui';

export interface CardDisplay {
  size: CardSize;
  style: Exclude<CardStyle, ''>;
  showDescription: boolean;
  showStatus: boolean;
  showLastAccess: boolean;
  showLaunchButton: boolean;
  variant: 'grid' | 'list' | 'compact';
}

export function displayFromUi(ui: UiSettings, variant: CardDisplay['variant']): CardDisplay {
  return {
    size: ui.cardSize,
    style: ui.defaultCardStyle,
    showDescription: ui.showServiceDescription,
    showStatus: ui.showServiceStatus,
    showLastAccess: ui.showLastAccess,
    showLaunchButton: ui.showLaunchButton,
    variant,
  };
}

const STATE_KIND: Record<string, 'ok' | 'warn' | 'err' | undefined> = { AVAILABLE: 'ok', MAINTENANCE: 'warn', LOCKED: undefined, STOPPED: 'err' };
const STATE_ICON: Record<string, string> = { AVAILABLE: 'check_circle', MAINTENANCE: 'construction', LOCKED: 'lock', STOPPED: 'block' };

interface Props {
  service: ServiceCard;
  display: CardDisplay;
  categoryName?: string;
  onLaunch: (s: ServiceCard) => void;
  onToggleFavorite?: (s: ServiceCard) => void;
  busy?: boolean;
}

export function DynamicServiceCard({ service: s, display, categoryName, onLaunch, onToggleFavorite, busy }: Props) {
  const color = /^#[0-9a-fA-F]{6}$/.test(s.primaryColor) ? s.primaryColor : '#2563EB';
  const vars = { '--svc': color, '--card-bg': s.backgroundColor && s.backgroundColor !== '#FFFFFF' ? s.backgroundColor : undefined } as CSSProperties;
  const style = (s.cardStyle || display.style) as Exclude<CardStyle, ''>;
  const locked = s.state === 'LOCKED';
  const stateBadge = display.showStatus && (
    <Badge kind={STATE_KIND[s.state]} icon={STATE_ICON[s.state]}>{CARD_STATE_LABEL[s.state]}</Badge>
  );
  const launchLabel = s.state === 'AVAILABLE' ? `${s.serviceName} 접속` : `${s.serviceName} — ${CARD_STATE_LABEL[s.state]}`;
  const fav = onToggleFavorite && !locked && (
    <button
      type="button"
      className="icon-btn small fav"
      aria-pressed={!!s.favorite}
      aria-label={s.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      onClick={(e) => { e.stopPropagation(); onToggleFavorite(s); }}
    >
      <Icon name="star" fill={!!s.favorite} />
    </button>
  );

  if (display.variant === 'compact') {
    return (
      <button type="button" className="svc-tile" style={vars} disabled={!s.canLaunch || busy} onClick={() => onLaunch(s)} aria-label={launchLabel} title={s.description || s.serviceName}>
        {s.isNew && <Badge kind="new">NEW</Badge>}
        <span className="svc-icon"><Icon name={locked ? 'lock' : s.icon} /></span>
        <span className="name">{s.serviceName}</span>
        {display.showStatus && s.state !== 'AVAILABLE' && <span className="small muted">{CARD_STATE_LABEL[s.state]}</span>}
      </button>
    );
  }

  if (display.variant === 'list' || style === 'list') {
    return (
      <div className={`svc-row${locked ? ' locked' : ''}`} style={vars} data-service-id={s.serviceId}>
        <span className="svc-icon"><Icon name={locked ? 'lock' : s.icon} /></span>
        <div className="info">
          <strong>{s.serviceName} {s.isNew && <Badge kind="new">NEW</Badge>}</strong>
          {display.showDescription && !locked && <span>{s.description}</span>}
        </div>
        <span className="hide-sm">{stateBadge}</span>
        {display.showLastAccess && s.lastAccessAt && <span className="small muted hide-md" title={fmtDateTime(s.lastAccessAt)}>{relativeTime(s.lastAccessAt)}</span>}
        {fav}
        <button type="button" className="btn small" disabled={!s.canLaunch || busy} onClick={() => onLaunch(s)} aria-label={launchLabel}>
          {s.canLaunch ? '접속' : CARD_STATE_LABEL[s.state]}
        </button>
      </div>
    );
  }

  return (
    <article className={`svc-card size-${display.size} style-${style}${locked ? ' locked' : ''}`} style={vars} data-service-id={s.serviceId} aria-label={s.serviceName}>
      <div className="accent" />
      {style === 'thumbnail' && s.thumbnailUrl && !locked && <div className="thumb" style={{ backgroundImage: `url("${encodeURI(s.thumbnailUrl)}")` }} role="img" aria-label={`${s.serviceName} 썸네일`} />}
      <div className="body">
        <div className="top">
          <span className="svc-icon"><Icon name={locked ? 'lock' : s.icon} /></span>
          <div className="grow">
            <h3>{s.serviceName}</h3>
            {s.englishName && !locked && <div className="en">{s.englishName}</div>}
          </div>
          {fav}
        </div>
        {display.showDescription && !locked && s.description && <p className="desc">{s.description}</p>}
        {s.state === 'MAINTENANCE' && s.maintenanceMessage && <p className="small" style={{ color: 'var(--warning-text)', margin: 0 }}>{s.maintenanceMessage}</p>}
        {locked && <p className="desc">접근 권한이 없는 서비스입니다. 이용이 필요하면 관리자에게 문의하세요.</p>}
        <div className="meta">
          {s.isNew && <Badge kind="new">NEW</Badge>}
          {stateBadge}
          {categoryName && <Badge>{categoryName}</Badge>}
          {s.isPinned && <Badge kind="info" icon="push_pin">고정</Badge>}
        </div>
      </div>
      {(display.showLaunchButton || display.showLastAccess) && (
        <div className="foot">
          <span className="small muted">
            {display.showLastAccess && !locked ? (s.lastAccessAt ? <span title={fmtDateTime(s.lastAccessAt)}>최근 이용 {relativeTime(s.lastAccessAt)}</span> : '최근 이용 기록 없음') : null}
          </span>
          {display.showLaunchButton && (
            <button type="button" className="btn small" disabled={!s.canLaunch || busy} onClick={() => onLaunch(s)} aria-label={launchLabel}>
              {s.canLaunch ? <>접속 <Icon name="open_in_new" /></> : CARD_STATE_LABEL[s.state]}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
