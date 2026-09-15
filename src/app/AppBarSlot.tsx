import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsActivePage } from './ActivePage';

/**
 * アプリバー右側の差し込み口。
 *
 * ヘルプやリポジトリへの導線はフッターやホームに十分あるので、
 * この場所は「いま開いている画面の主要な操作」に使う。
 * 画面が縦に長くなりがちなスマホでも、書き出しボタンに常に手が届く。
 */
const AppBarSlotContext = createContext<HTMLElement | null>(null);

export const AppBarSlotProvider = AppBarSlotContext.Provider;

export function AppBarSlot({ children }: { children: ReactNode }) {
  const host = useContext(AppBarSlotContext);
  // 隠れている画面のボタンは出さない (前面の画面のものだけを置く)
  const active = useIsActivePage();
  if (!host || !active) return null;
  return createPortal(children, host);
}
