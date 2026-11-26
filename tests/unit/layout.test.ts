import { describe, expect, it } from 'vitest';
import { autoDesktopColumns, computeLayout, deviceForWidth } from '../../src/utils/layout';
import type { UiSettings } from '../../src/types';

const ui: Pick<UiSettings, 'layoutMode' | 'desktopColumns' | 'tabletColumns' | 'mobileColumns' | 'cardSize' | 'pageSize'> = {
  layoutMode: 'auto', desktopColumns: 0, tabletColumns: 0, mobileColumns: 1, cardSize: 'default', pageSize: 24,
};

describe('자동 레이아웃 (19장)', () => {
  it('기기 구분: <600 모바일, <1024 태블릿, 그 이상 PC', () => {
    expect(deviceForWidth(390)).toBe('mobile');
    expect(deviceForWidth(820)).toBe('tablet');
    expect(deviceForWidth(1280)).toBe('desktop');
  });

  it.each([
    [0, 1], [1, 1], [2, 2], [3, 3], [4, 2], [5, 3], [6, 3], [10, 4], [20, 4], [50, 4], [100, 4],
  ])('PC 1440px: 서비스 %i개 → %i열', (count, cols) => {
    expect(computeLayout(count, 1440, ui).columns).toBe(cols);
  });

  it('7~12개는 1280px 미만이면 3열', () => {
    expect(autoDesktopColumns(10, 1100)).toBe(3);
    expect(autoDesktopColumns(10, 1300)).toBe(4);
  });

  it('1개는 중앙 집중형, 13개 이상은 필터 강조, 21개 이상은 카테고리 그룹', () => {
    expect(computeLayout(1, 1440, ui).centered).toBe(true);
    expect(computeLayout(12, 1440, ui).emphasizeFilter).toBe(false);
    expect(computeLayout(13, 1440, ui).emphasizeFilter).toBe(true);
    expect(computeLayout(20, 1440, ui).grouped).toBe(false);
    expect(computeLayout(21, 1440, ui).grouped).toBe(true);
  });

  it('많은 서비스는 페이지 나누기', () => {
    expect(computeLayout(24, 1440, ui).paginate).toBe(false);
    expect(computeLayout(50, 1440, ui).paginate).toBe(true);
    expect(computeLayout(100, 1440, ui).pageSize).toBe(24);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 10, 20, 50, 100])('모바일 390px: %i개 → 1열', (count) => {
    expect(computeLayout(count, 390, ui).columns).toBe(1);
  });

  it('모바일 2열은 관리자 허용 + 480px 이상에서만', () => {
    expect(computeLayout(10, 390, { ...ui, mobileColumns: 2 }).columns).toBe(1);
    expect(computeLayout(10, 560, { ...ui, mobileColumns: 2 }).columns).toBe(2);
  });

  it.each([3, 4, 6, 10, 20, 50, 100])('태블릿 820px: %i개 → 2열 (카드 최소 너비 보장)', (count) => {
    const l = computeLayout(count, 820, ui);
    expect(l.columns).toBe(2);
    expect((820 - (l.columns - 1) * 16) / l.columns).toBeGreaterThanOrEqual(l.minCardWidth);
  });

  it.each([[0, 1], [1, 1], [2, 2], [3, 3], [5, 3], [10, 3], [100, 3]])('태블릿 1000px: %i개 → %i열', (count, cols) => {
    expect(computeLayout(count, 1000, ui).columns).toBe(cols);
  });

  it('어떤 너비·개수에서도 카드가 최소 너비보다 좁아지지 않음 (가로 스크롤 방지)', () => {
    for (const w of [320, 360, 390, 600, 768, 820, 1024, 1280, 1440, 1920]) {
      for (const n of [0, 1, 2, 3, 4, 5, 6, 10, 20, 50, 100]) {
        for (const size of ['large', 'default', 'small', 'compact'] as const) {
          const l = computeLayout(n, w, { ...ui, cardSize: size, desktopColumns: 6 });
          const cardW = (Math.max(240, w) - (l.columns - 1) * 16) / l.columns;
          if (l.columns > 1) expect(cardW).toBeGreaterThanOrEqual(l.device === 'mobile' ? 150 : l.minCardWidth);
          expect(l.columns).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('관리자 고정 열 수(grid3)·목록형·컴팩트 모드', () => {
    expect(computeLayout(10, 1440, { ...ui, layoutMode: 'grid3' }).columns).toBe(3);
    expect(computeLayout(10, 1440, { ...ui, layoutMode: 'list' }).variant).toBe('list');
    expect(computeLayout(10, 1440, { ...ui, layoutMode: 'compact' }).variant).toBe('compact');
    expect(computeLayout(2, 1440, { ...ui, layoutMode: 'grid4' }).columns).toBe(2); // 서비스 수보다 많은 열은 만들지 않음
  });
});
