import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsActivePage } from '../app/ActivePage';

export interface DialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  /** 背景クリックとEscで閉じないようにする (処理中など) */
  persistent?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open: wanted, title, children, actions, onClose, persistent }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 画面を切り替えたら、隠れた画面のダイアログは出したままにしない
  const activePage = useIsActivePage();
  const open = wanted && activePage;
  // onClose は呼び出し側で毎回新しく作られることが多い。
  // これを効果の依存に入れると、入力するたびに効果が動き直して
  // 焦点が入力欄からダイアログ本体へ飛んでしまう。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const persistentRef = useRef(persistent);
  persistentRef.current = persistent;

  useEffect(() => {
    if (!open) return;
    // 開く前に触っていた場所を覚えておき、閉じたら戻す
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !persistentRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // ダイアログの外へ出ないよう、先頭と末尾をつなげる
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
    // 焦点合わせは「開いた瞬間」だけ。以降は利用者の操作に任せる。
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // 閉じたら、開くのに使ったボタンへ戻す (キーボードで辿り直さなくて済む)
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!persistent && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <h2 className="dialog__title">{title}</h2>
        <div>{children}</div>
        {actions ? <div className="dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
