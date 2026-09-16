import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsActivePage } from '../app/ActivePage';
import { useFocusTrap } from './useFocusTrap';

export interface DialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  /** 背景クリックとEscで閉じないようにする (処理中など) */
  persistent?: boolean;
  /** 一覧など、横幅が要る中身のとき */
  wide?: boolean;
}

export function Dialog({ open: wanted, title, children, actions, onClose, persistent, wide }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 画面を切り替えたら、隠れた画面のダイアログは出したままにしない
  const activePage = useIsActivePage();
  const open = wanted && activePage;

  // 焦点の面倒 (初期位置・Tabの循環・閉じたあとの戻し) は共通のフックに任せる
  useFocusTrap(open, panelRef, { onEscape: onClose, locked: persistent });

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!persistent && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <h2 className="dialog__title">{title}</h2>
        <div>{children}</div>
        {actions ? <div className="dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
