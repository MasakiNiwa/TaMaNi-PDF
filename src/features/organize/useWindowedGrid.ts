import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * ページ一覧を「見えているぶんだけ」描くための計算。
 *
 * ページ数が数百になると、カードを全部置くだけでブラウザが重くなる
 * (1枚あたりボタンが6つあるため、300ページで数千個の要素になる)。
 * そこで画面に入る行だけを描き、その上下は同じ高さの余白で埋めて
 * スクロールの長さを合わせる。
 *
 * 段の数と行の高さは、実際に描かれたカードから測る。
 * 段組みはCSS側 (grid) が決めるので、JSで計算し直すとズレるため。
 */

export interface WindowedGrid {
  /** 描き始めるページ番号 (0始まり) */
  start: number;
  /** 描き終わりの次のページ番号 */
  end: number;
  /** 上に空ける高さ (px) */
  padTop: number;
  /** 下に空ける高さ (px) */
  padBottom: number;
  /** 実際に間引いているか */
  active: boolean;
}

export interface WindowedGridOptions {
  total: number;
  /** これ以下の枚数なら間引かない */
  threshold?: number;
  /** 画面の外に余分に描いておく行数 */
  overscanRows?: number;
}

const FULL = (total: number): WindowedGrid => ({
  start: 0,
  end: total,
  padTop: 0,
  padBottom: 0,
  active: false,
});

export function useWindowedGrid(
  gridRef: React.RefObject<HTMLElement | null>,
  { total, threshold = 60, overscanRows = 2 }: WindowedGridOptions,
): WindowedGrid {
  const [metrics, setMetrics] = useState<{ columns: number; rowHeight: number } | null>(null);
  const [range, setRange] = useState<WindowedGrid>(() => FULL(total));
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const enabled = total > threshold;

  /** 描かれているカードから、段の数と行の高さを測る */
  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = grid.querySelectorAll<HTMLElement>('.page-card');
    if (cards.length === 0) return;

    const first = cards[0];
    const firstTop = first.offsetTop;
    let columns = 0;
    for (const card of cards) {
      if (card.offsetTop !== firstTop) break;
      columns += 1;
    }
    // 2行目の頭との差が、余白を含む1行の高さ
    let rowHeight = first.offsetHeight;
    for (const card of cards) {
      if (card.offsetTop !== firstTop) {
        rowHeight = card.offsetTop - firstTop;
        break;
      }
    }
    if (columns < 1 || rowHeight < 1) return;
    const next = { columns, rowHeight };
    const current = metricsRef.current;
    if (current && current.columns === next.columns && current.rowHeight === next.rowHeight) return;
    setMetrics(next);
  }, [gridRef]);

  useLayoutEffect(() => {
    if (!enabled) {
      setRange(FULL(total));
      return;
    }
    measure();
  }, [enabled, total, measure]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!enabled || !grid || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(grid);
    return () => observer.disconnect();
  }, [enabled, gridRef, measure]);

  useEffect(() => {
    if (!enabled || !metrics) {
      if (!enabled) setRange(FULL(total));
      return;
    }

    const grid = gridRef.current;
    if (!grid) return;
    const { columns, rowHeight } = metrics;
    const rows = Math.ceil(total / columns);

    let frame = 0;
    const update = () => {
      frame = 0;
      const box = grid.getBoundingClientRect();
      // 一覧の先頭から、画面の上端までの距離 (上に隠れているぶん)
      const hiddenAbove = Math.max(0, -box.top);
      const firstRow = Math.max(0, Math.floor(hiddenAbove / rowHeight) - overscanRows);
      const visibleRows = Math.ceil(window.innerHeight / rowHeight) + overscanRows * 2;
      const lastRow = Math.min(rows, firstRow + visibleRows);

      const start = firstRow * columns;
      const end = Math.min(total, lastRow * columns);
      setRange((current) =>
        current.start === start && current.end === end && current.active
          ? current
          : {
              start,
              end,
              padTop: firstRow * rowHeight,
              padBottom: Math.max(0, (rows - lastRow) * rowHeight),
              active: true,
            },
      );
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [enabled, metrics, total, gridRef, overscanRows]);

  return enabled && metrics ? range : FULL(total);
}
