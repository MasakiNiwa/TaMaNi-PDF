import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closePdf } from '../../core/pdf/pdfjs';
import { ThumbnailCache } from '../../core/pdf/render';
import { normalizeRotation, type PageRef, type PdfSource, type Rotation } from '../../core/pdf/types';
import { createId } from '../../core/util/id';

const HISTORY_LIMIT = 50;

/**
 * ページの並びと、その操作履歴 (Undo/Redo) を持つ。
 *
 * 履歴に積むのは PageRef の配列だけで、PDFの実体はコピーしない。
 * PageRef は「どの供給元の何ページ目か」を指すだけの軽い値なので、
 * 何十回 Undo してもメモリを圧迫しない。
 */
interface History {
  stack: PageRef[][];
  index: number;
}

const EMPTY_HISTORY: History = { stack: [[]], index: 0 };

export function usePageDeck() {
  const [sources, setSources] = useState<Map<string, PdfSource>>(() => new Map());
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);

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

  const pages = history.stack[history.index];

  const commit = useCallback((next: PageRef[] | ((current: PageRef[]) => PageRef[])) => {
    setHistory((current) => {
      const currentPages = current.stack[current.index];
      const resolved = typeof next === 'function' ? next(currentPages) : next;
      if (resolved === currentPages) return current;
      // やり直し分を捨ててから新しい状態を積む
      const stack = [...current.stack.slice(0, current.index + 1), resolved];
      const overflow = Math.max(0, stack.length - HISTORY_LIMIT);
      const trimmed = stack.slice(overflow);
      return { stack: trimmed, index: trimmed.length - 1 };
    });
  }, []);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;

  const undo = useCallback(() => {
    setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1) }));
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => ({ ...current, index: Math.min(current.stack.length - 1, current.index + 1) }));
  }, []);

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
    setHistory(EMPTY_HISTORY);
  }, [thumbnails]);

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
    canUndo,
    canRedo,
    undo,
    redo,
    addSource,
    reset,
    rotatePages,
    deletePages,
    duplicatePages,
    movePage,
    reorder,
  };
}
