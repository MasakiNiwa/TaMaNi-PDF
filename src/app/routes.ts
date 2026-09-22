import type { IconName } from '../ui/Icon';

export type RouteId = 'home' | 'organize' | 'redact' | 'batch' | 'compress' | 'settings' | 'help';

export interface RouteDef {
  id: RouteId;
  path: string;
  label: string;
  /** ナビゲーションに出す短いラベル */
  navLabel: string;
  icon: IconName;
  description: string;
  /** 下部ナビ/レールに表示するか */
  inNav: boolean;
}

export const ROUTES: RouteDef[] = [
  {
    id: 'home',
    path: '/',
    label: 'ホーム',
    navLabel: 'ホーム',
    icon: 'home',
    description: 'たまに使いたいPDF操作をまとめた道具箱です。',
    inNav: true,
  },
  {
    id: 'organize',
    path: '/organize',
    label: 'ページ整理',
    navLabel: '整理',
    icon: 'pages',
    description: 'PDFをまとめる・並べ替える。向きを直す、いらないページを消す、番号をふる。',
    inNav: true,
  },
  {
    id: 'redact',
    path: '/redact',
    label: '墨消し',
    navLabel: '墨消し',
    icon: 'draw',
    description: '見せたくない情報を隠す。下に残った文字ごと消すので、あとから読めません。',
    inNav: true,
  },
  {
    id: 'batch',
    path: '/batch',
    label: '一括墨消し',
    navLabel: '一括',
    icon: 'layers',
    description: '同じ書式のPDFを、同じ場所でまとめて隠す。毎月届く書類などに。',
    inNav: true,
  },
  {
    id: 'compress',
    path: '/compress',
    label: 'サイズ圧縮',
    navLabel: '圧縮',
    icon: 'compress',
    description: '大きすぎるPDFを軽くする。「上限に引っかかって出せない」ときに。',
    inNav: true,
  },
  {
    id: 'settings',
    path: '/settings',
    label: '設定',
    navLabel: '設定',
    icon: 'settings',
    description: '画質・テーマ・テンプレートの管理、バージョン情報。',
    inNav: true,
  },
  {
    id: 'help',
    path: '/help',
    label: 'ヘルプ',
    navLabel: 'ヘルプ',
    icon: 'help',
    description: '使い方、墨消しの仕組み、プライバシーについて。',
    inNav: true,
  },
];

export const ROUTE_BY_ID = new Map(ROUTES.map((route) => [route.id, route]));

export function routeFromHash(hash: string): RouteDef {
  const path = hash.replace(/^#/, '') || '/';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return ROUTES.find((route) => route.path === normalized) ?? ROUTES[0];
}

export function hrefFor(route: RouteDef | RouteId): string {
  const def = typeof route === 'string' ? ROUTE_BY_ID.get(route) : route;
  return `#${def?.path ?? '/'}`;
}
