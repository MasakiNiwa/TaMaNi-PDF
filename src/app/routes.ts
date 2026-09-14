import type { IconName } from '../ui/Icon';

export type RouteId = 'home' | 'organize' | 'redact' | 'batch' | 'settings' | 'help';

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
    description: 'ページの並べ替え・回転・追加・削除をして1つのPDFにまとめます。',
    inNav: true,
  },
  {
    id: 'redact',
    path: '/redact',
    label: '墨消し',
    navLabel: '墨消し',
    icon: 'draw',
    description: '隠したい部分を塗りつぶします。下に隠れた文字ごと消えます。',
    inNav: true,
  },
  {
    id: 'batch',
    path: '/batch',
    label: '一括墨消し',
    navLabel: '一括',
    icon: 'layers',
    description: '保存したテンプレートを使って複数のPDFをまとめて墨消しします。',
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
