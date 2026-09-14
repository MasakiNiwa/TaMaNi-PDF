import type { NormalizedRect, RedactColor } from '../pdf/redact';
import { createId } from '../util/id';
import { readJson, writeJson } from './store';

/**
 * 墨消し範囲を「どのページに当てるか」の指定。
 *
 * ページ番号を直接持たず種類で表すことで、ページ数の違うPDFにも
 * 同じテンプレートを適用できる。
 */
export type PageScope =
  | { type: 'all' }
  /** 先頭から index ページ目 (0始まり) */
  | { type: 'index'; index: number }
  /** 末尾から index ページ目 (0始まり。0 が最終ページ) */
  | { type: 'fromEnd'; index: number }
  | { type: 'odd' }
  | { type: 'even' };

export interface TemplateRect extends NormalizedRect {
  id: string;
  scope: PageScope;
}

export const TEMPLATE_VERSION = 1;

export interface RedactTemplate {
  id: string;
  name: string;
  version: number;
  rects: TemplateRect[];
  createdAt: string;
  updatedAt: string;
  /** 作成時の元PDFのページ数 (適用前の目安表示に使う) */
  sourcePageCount?: number;
}

const KEY = 'templates';

/** その矩形が指定ページに適用されるか */
export function scopeMatches(scope: PageScope, pageIndex: number, pageCount: number): boolean {
  switch (scope.type) {
    case 'all':
      return true;
    case 'index':
      return scope.index === pageIndex;
    case 'fromEnd':
      return pageCount - 1 - scope.index === pageIndex;
    case 'odd':
      // 人が数える1始まりのページ番号で判定する
      return (pageIndex + 1) % 2 === 1;
    case 'even':
      return (pageIndex + 1) % 2 === 0;
    default:
      return false;
  }
}

export function scopeLabel(scope: PageScope): string {
  switch (scope.type) {
    case 'all':
      return '全ページ';
    case 'index':
      return `${scope.index + 1}ページ目`;
    case 'fromEnd':
      return scope.index === 0 ? '最終ページ' : `最後から${scope.index + 1}ページ目`;
    case 'odd':
      return '奇数ページ';
    case 'even':
      return '偶数ページ';
    default:
      return '不明';
  }
}

/** テンプレートから、指定ページに適用すべき矩形だけを取り出す */
export function rectsForPage(
  template: RedactTemplate,
  pageIndex: number,
  pageCount: number,
): NormalizedRect[] {
  return template.rects.filter((rect) => scopeMatches(rect.scope, pageIndex, pageCount));
}

function isColor(value: unknown): value is RedactColor {
  return value === 'black' || value === 'white';
}

function coerceScope(raw: unknown): PageScope | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const scope = raw as { type?: unknown; index?: unknown };
  switch (scope.type) {
    case 'all':
    case 'odd':
    case 'even':
      return { type: scope.type };
    case 'index':
    case 'fromEnd': {
      const index = Number(scope.index);
      if (!Number.isInteger(index) || index < 0) return null;
      return { type: scope.type, index };
    }
    default:
      return null;
  }
}

function coerceRect(raw: unknown): TemplateRect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rect = raw as Partial<TemplateRect>;
  const scope = coerceScope(rect.scope);
  if (!scope) return null;
  const nums = [rect.x, rect.y, rect.w, rect.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(rect.x as number);
  const y = clamp(rect.y as number);
  const w = Math.min(1 - x, Math.max(0, rect.w as number));
  const h = Math.min(1 - y, Math.max(0, rect.h as number));
  if (w <= 0 || h <= 0) return null;
  return {
    id: typeof rect.id === 'string' ? rect.id : createId('rect'),
    x,
    y,
    w,
    h,
    color: isColor(rect.color) ? rect.color : 'black',
    scope,
  };
}

/** 外部から来たJSONを検証して読み込む。壊れた項目は捨てる。 */
export function coerceTemplate(raw: unknown): RedactTemplate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<RedactTemplate>;
  if (!Array.isArray(value.rects)) return null;
  const rects = value.rects.map(coerceRect).filter((rect): rect is TemplateRect => rect !== null);
  if (rects.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id: typeof value.id === 'string' ? value.id : createId('tpl'),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 80) : '名称未設定',
    version: TEMPLATE_VERSION,
    rects,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    sourcePageCount:
      typeof value.sourcePageCount === 'number' && value.sourcePageCount > 0 ? value.sourcePageCount : undefined,
  };
}

export function loadTemplates(): RedactTemplate[] {
  const raw = readJson<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceTemplate).filter((tpl): tpl is RedactTemplate => tpl !== null);
}

export function saveTemplates(templates: RedactTemplate[]): boolean {
  return writeJson(KEY, templates);
}

export interface TemplateExportFile {
  app: 'tamani-pdf';
  kind: 'redact-templates';
  version: number;
  exportedAt: string;
  templates: RedactTemplate[];
}

export function buildExportFile(templates: RedactTemplate[]): TemplateExportFile {
  return {
    app: 'tamani-pdf',
    kind: 'redact-templates',
    version: TEMPLATE_VERSION,
    exportedAt: new Date().toISOString(),
    templates,
  };
}

/** 書き出したJSONを読み戻す。単体テンプレート・配列・書き出しファイルのどれでも受ける。 */
export function parseImportFile(text: string): RedactTemplate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読み取れませんでした。');
  }
  const candidates = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as TemplateExportFile).templates)
      ? (parsed as TemplateExportFile).templates
      : [parsed];
  const templates = candidates.map(coerceTemplate).filter((tpl): tpl is RedactTemplate => tpl !== null);
  if (templates.length === 0) throw new Error('読み込めるテンプレートが含まれていませんでした。');
  return templates;
}
