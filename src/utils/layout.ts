/**
 * 자동 UI 레이아웃 계산 (19장)
 *
 * 기준: "현재 사용자에게 표시되는 서비스 수" + "실제 사용 가능한 화면(컨테이너) 너비".
 * 서비스 개수를 소스코드에 고정하지 않으며, 카드가 최소 너비보다 작아지지 않도록 열 수를 줄인다.
 */
import type { CardSize, LayoutMode, UiSettings } from '../types';

export type Device = 'mobile' | 'tablet' | 'desktop';

export interface LayoutResult {
  device: Device;
  /** grid: 카드 그리드, list: 리스트형, compact: 아이콘형 */
  variant: 'grid' | 'list' | 'compact';
  columns: number;
  /** 카테고리별로 묶어서 표시 */
  grouped: boolean;
  /** 페이지 나누기 사용 */
  paginate: boolean;
  pageSize: number;
  /** 카테고리 필터를 강조 표시 (13개 이상) */
  emphasizeFilter: boolean;
  /** 1개일 때 중앙 집중형 */
  centered: boolean;
  /** 카드 최소 너비(px) */
  minCardWidth: number;
}

export const MIN_CARD_WIDTH: Record<CardSize, number> = { large: 340, default: 280, small: 220, compact: 170 };
export const GAP = 16;

export function deviceForWidth(width: number): Device {
  if (width < 600) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/** 서비스 수에 따른 데스크톱 기본 열 수 (19장 표) */
export function autoDesktopColumns(count: number, width: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 2;
  if (count <= 6) return 3;
  if (count <= 12) return width >= 1280 ? 4 : 3;
  return 4;
}

function fixedColumns(mode: LayoutMode): number | null {
  if (mode === 'grid2') return 2;
  if (mode === 'grid3') return 3;
  if (mode === 'grid4') return 4;
  return null;
}

export function computeLayout(count: number, width: number, ui: Pick<UiSettings, 'layoutMode' | 'desktopColumns' | 'tabletColumns' | 'mobileColumns' | 'cardSize' | 'pageSize'>): LayoutResult {
  const w = Math.max(240, width || 0);
  const device = deviceForWidth(w);
  const cardSize: CardSize = ui.cardSize || 'default';
  const minCard = MIN_CARD_WIDTH[cardSize] ?? 280;
  const mode = ui.layoutMode || 'auto';
  const pageSize = Math.max(6, ui.pageSize || 24);
  const fitByWidth = (min: number) => Math.max(1, Math.floor((w + GAP) / (min + GAP)));

  if (mode === 'list') {
    return { device, variant: 'list', columns: 1, grouped: false, paginate: count > pageSize, pageSize, emphasizeFilter: count > 12, centered: false, minCardWidth: 0 };
  }
  if (mode === 'compact') {
    const cols = Math.max(1, Math.min(count || 1, fitByWidth(device === 'mobile' ? 96 : 120)));
    return { device, variant: 'compact', columns: cols, grouped: false, paginate: count > pageSize * 2, pageSize: pageSize * 2, emphasizeFilter: count > 12, centered: false, minCardWidth: 96 };
  }

  let desired: number;
  if (device === 'mobile') {
    // 기본 1열. 충분한 너비(>=480px)가 확보되고 관리자가 2열을 허용하면 2열 컴팩트
    desired = ui.mobileColumns === 2 && w >= 480 ? 2 : 1;
  } else if (device === 'tablet') {
    desired = ui.tabletColumns || (fixedColumns(mode) ? Math.min(3, fixedColumns(mode)!) : w >= 840 && count >= 3 ? 3 : 2);
  } else {
    desired = fixedColumns(mode) || ui.desktopColumns || autoDesktopColumns(count, w);
  }
  const mobileMin = device === 'mobile' && desired === 2 ? 150 : minCard;
  const columns = Math.max(1, Math.min(desired, fitByWidth(device === 'mobile' ? Math.min(mobileMin, w) : minCard), Math.max(1, count)));
  const grouped = mode === 'grouped' || (mode === 'auto' && count >= 21);
  return {
    device,
    variant: 'grid',
    columns,
    grouped,
    paginate: count > pageSize && !(mode === 'grouped' && count <= pageSize * 2),
    pageSize,
    emphasizeFilter: count >= 13,
    centered: count === 1 && device !== 'mobile',
    minCardWidth: minCard,
  };
}
