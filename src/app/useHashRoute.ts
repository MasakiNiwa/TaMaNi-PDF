import { useEffect, useState } from 'react';
import { routeFromHash, type RouteDef } from './routes';

/**
 * ハッシュルーティング。
 * GitHub Pages のような静的ホスティングではサーバ側でパスを書き換えられないため、
 * URL のハッシュだけで画面を切り替えて 404 を避ける。
 */
export function useHashRoute(): RouteDef {
  const [route, setRoute] = useState<RouteDef>(() => routeFromHash(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(routeFromHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    document.title = route.id === 'home' ? 'たまにPDF' : `${route.label} | たまにPDF`;
  }, [route]);

  return route;
}
