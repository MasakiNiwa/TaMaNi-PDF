import { createContext, useContext } from 'react';

/**
 * 「いま前面に出ている画面かどうか」。
 *
 * 作業中の画面はナビゲーションで消さず、隠して残している (App.tsx)。
 * 隠れている画面がアプリバーへボタンを差し込んだり、ダイアログを出したままにすると
 * 前面の画面と混ざってしまうので、この値で描き分ける。
 */
const ActivePageContext = createContext(true);

export const ActivePageProvider = ActivePageContext.Provider;

export function useIsActivePage(): boolean {
  return useContext(ActivePageContext);
}
