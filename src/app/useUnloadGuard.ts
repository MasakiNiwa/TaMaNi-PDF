import { useEffect } from 'react';

/**
 * 作業中にタブを閉じたり再読み込みしたりしたときの、引き止め。
 *
 * このアプリはPDFを端末の外へ出さない代わりに、どこにも保存していない。
 * タブを閉じれば読み込んだPDFも編集内容も消えるので、
 * 消えて困るものがあるあいだだけブラウザ標準の確認を出す。
 *
 * 文言はブラウザが決めるため、こちらからは指定できない。
 */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 古いブラウザ向け
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
