import { useEffect, useRef, type RefObject } from 'react';

/**
 * 画面を覆う表示 (ダイアログ・拡大表示) の、キーボード操作の面倒を見る。
 *
 * - 開いた瞬間だけ中へ焦点を移す (開いているあいだの入力では動かさない)
 * - Tab は中で回す。背面のリンクへ抜けてしまうと、閉じ方が分からなくなる
 * - 閉じたら、開くのに使ったボタンへ戻す
 *
 * 焦点合わせを「開いた瞬間だけ」にするのが肝心で、毎回作り直される関数を
 * 効果の依存に入れると、入力のたびに焦点が飛んでしまう。
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  /** Esc が押されたとき。渡さなければ何もしない。 */
  onEscape?: () => void;
  /** Esc で閉じないようにする (処理中など) */
  locked?: boolean;
}

export function useFocusTrap(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  options: FocusTrapOptions = {},
): void {
  // 呼び出し側で毎回新しく作られるので、最新のものを参照だけしておく
  // (効果の依存に入れると、描き直しのたびに焦点が飛ぶ)
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !optionsRef.current.locked) {
        optionsRef.current.onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const targets = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (targets.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (active instanceof Node && !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
    // 開閉のときだけ動かす。中身の入れ替わりでは動かさない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
