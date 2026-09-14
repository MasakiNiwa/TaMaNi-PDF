import { useCallback, useMemo, useState } from 'react';

const DEFAULT_LIMIT = 50;

/**
 * 取り消し / やり直しつきの状態。
 *
 * ドラッグ中のように値が毎フレーム変わる操作では、その途中経過まで履歴に積むと
 * 「元に戻す」を何十回も押す羽目になる。そこで値の更新を2種類に分けている。
 *
 * - `setLive`  … 履歴に積まない更新 (ドラッグ中の追従など)
 * - `commit`   … そこまでの結果をひと区切りとして履歴に積む (指を離したときなど)
 *
 * 履歴に持つのは状態そのものなので、扱う値は軽いものに限る
 * (このアプリではページの並びと墨消し範囲の座標だけ)。
 */
export interface HistoryState<T> {
  value: T;
  canUndo: boolean;
  canRedo: boolean;
  /** 履歴に積まずに今の値だけ差し替える */
  setLive: (next: T | ((current: T) => T)) => void;
  /** 値を更新して、ひと区切りとして履歴に積む */
  commit: (next: T | ((current: T) => T)) => void;
  /** いまの値をそのまま履歴に積む (setLive で動かしたあとの確定に使う) */
  commitCurrent: () => void;
  undo: () => void;
  redo: () => void;
  /** 初期値に戻して履歴も消す */
  reset: (value?: T) => void;
}

interface Internal<T> {
  /** 確定済みの状態。index が現在位置。 */
  stack: T[];
  index: number;
  /** 確定していない今の値 (ドラッグ中など)。null なら stack[index] が今の値。 */
  live: T | null;
}

export function useHistoryState<T>(initial: T, limit = DEFAULT_LIMIT): HistoryState<T> {
  const [state, setState] = useState<Internal<T>>({ stack: [initial], index: 0, live: null });

  const value = state.live ?? state.stack[state.index];

  const resolve = useCallback((next: T | ((current: T) => T), current: T): T => {
    return typeof next === 'function' ? (next as (current: T) => T)(current) : next;
  }, []);

  const setLive = useCallback(
    (next: T | ((current: T) => T)) => {
      setState((current) => {
        const now = current.live ?? current.stack[current.index];
        return { ...current, live: resolve(next, now) };
      });
    },
    [resolve],
  );

  const push = useCallback((current: Internal<T>, resolved: T): Internal<T> => {
    const committed = current.stack[current.index];
    if (Object.is(resolved, committed)) return { ...current, live: null };
    // やり直し分を捨ててから積む
    const stack = [...current.stack.slice(0, current.index + 1), resolved];
    const overflow = Math.max(0, stack.length - limit);
    const trimmed = stack.slice(overflow);
    return { stack: trimmed, index: trimmed.length - 1, live: null };
  }, [limit]);

  const commit = useCallback(
    (next: T | ((current: T) => T)) => {
      setState((current) => {
        const now = current.live ?? current.stack[current.index];
        return push(current, resolve(next, now));
      });
    },
    [push, resolve],
  );

  const commitCurrent = useCallback(() => {
    setState((current) => (current.live === null ? current : push(current, current.live)));
  }, [push]);

  const undo = useCallback(() => {
    setState((current) => ({ ...current, index: Math.max(0, current.index - 1), live: null }));
  }, []);

  const redo = useCallback(() => {
    setState((current) => ({
      ...current,
      index: Math.min(current.stack.length - 1, current.index + 1),
      live: null,
    }));
  }, []);

  const reset = useCallback(
    (next?: T) => {
      setState((current) => ({ stack: [next ?? current.stack[0]], index: 0, live: null }));
    },
    [],
  );

  return useMemo(
    () => ({
      value,
      canUndo: state.index > 0,
      canRedo: state.index < state.stack.length - 1,
      setLive,
      commit,
      commitCurrent,
      undo,
      redo,
      reset,
    }),
    [value, state.index, state.stack.length, setLive, commit, commitCurrent, undo, redo, reset],
  );
}
