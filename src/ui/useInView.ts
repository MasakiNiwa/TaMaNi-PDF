import { useEffect, useState, type RefObject } from 'react';

/**
 * 要素が画面に入ったかどうか。
 * ページ数の多いPDFでサムネイルを一度に全部描かないために使う。
 * 一度入ったら true のまま (再描画のちらつきを避ける)。
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = '400px'): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
}
