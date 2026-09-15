import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryState } from '../../app/useHistoryState';
import { closePdf } from '../../core/pdf/pdfjs';
import { ThumbnailCache } from '../../core/pdf/render';
import { normalizeRotation, type PageRef, type PdfSource, type Rotation } from '../../core/pdf/types';
import { createId } from '../../core/util/id';

/**
 * ページの並びと、その操作履歴 (元に戻す / やり直す) を持つ。
 *
 * 履歴に積むのは PageRef の配列だけで、PDFの実体はコピーしない。
 * PageRef は「どの供給元の何ページ目か」を指すだけの軽い値なので、
 * 何十回戻してもメモリを圧迫しない。
 */
export function usePageDeck() {
  const [sources, setSources] = useState<Map<string, PdfSource>>(() => new Map());
  const history = useHistoryState<PageRef[]>([]);

  const thumbnails = useMemo(() => new ThumbnailCache(), []);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    return () => {
      thumbnails.clear();
      for (const source of sourcesRef.current.values()) {
        void closePdf(source.proxy);
      }
    };
  }, [thumbnails]);

  const pages = history.value;
  const commit = history.commit;

  const addSource = useCallback(
    (source: PdfSource, newPages: PageRef[]) => {
      setSources((current) => new Map(current).set(source.id, source));
      commit((currentPages) => [...currentPages, ...newPages]);
    },
    [commit],
  );

  const reset = useCallback(() => {
    thumbnails.clear();
    for (const source of sourcesRef.current.values()) {
      void closePdf(source.proxy);
    }
    setSources(new Map());
    history.reset([]);
  }, [thumbnails, history]);

  const rotatePages = useCallback(
    (ids: ReadonlySet<string> | null, delta: number) => {
      commit((current) =>
        current.map((page) =>
          !ids || ids.has(page.id)
            ? { ...page, rotation: normalizeRotation(page.rotation + delta) as Rotation }
            : page,
        ),
      );
    },
    [commit],
  );

  const deletePages = useCallback(
    (ids: ReadonlySet<string>) => {
      commit((current) => current.filter((page) => !ids.has(page.id)));
    },
    [commit],
  );

  /**
   * 選んだページだけを残す。
   *
   * 何十ページもあるPDFから数ページを抜き出したいとき、
   * いらないページを1枚ずつ消していくのは現実的でないため。
   */
  const keepOnly = useCallback(
    (ids: ReadonlySet<string>) => {
      commit((current) => {
        const kept = current.filter((page) => ids.has(page.id));
        // 1ページも残らない指定は受け付けない (空のPDFは作れない)
        return kept.length > 0 ? kept : current;
      });
    },
    [commit],
  );

  const duplicatePages = useCallback(
    (ids: ReadonlySet<string>) => {
      commit((current) =>
        current.flatMap((page) => (ids.has(page.id) ? [page, { ...page, id: createId('pg') }] : [page])),
      );
    },
    [commit],
  );

  const movePage = useCallback(
    (id: string, offset: number) => {
      commit((current) => {
        const index = current.findIndex((page) => page.id === id);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= current.length) return current;
        const next = [...current];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        return next;
      });
    },
    [commit],
  );

  const reorder = useCallback(
    (fromId: string, toId: string) => {
      commit((current) => {
        const from = current.findIndex((page) => page.id === fromId);
        const to = current.findIndex((page) => page.id === toId);
        if (from < 0 || to < 0 || from === to) return current;
        const next = [...current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [commit],
  );

  return {
    sources,
    pages,
    thumbnails,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
    addSource,
    reset,
    rotatePages,
    deletePages,
    keepOnly,
    duplicatePages,
    movePage,
    reorder,
  };
}
