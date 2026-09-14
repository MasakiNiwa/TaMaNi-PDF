import type { RedactColor } from '../pdf/redact';
import { readJson, writeJson } from './store';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeMode;
  /** 墨消し時のラスタライズ解像度 */
  redactDpi: number;
  redactFormat: 'jpeg' | 'png';
  jpegQuality: number;
  defaultRedactColor: RedactColor;
  /** ページ一覧のサムネイルの大きさ */
  thumbnailSize: 'small' | 'medium' | 'large';
  /** ページ整理の出力ファイル名につける接尾辞 */
  organizeSuffix: string;
  /** 墨消しの出力ファイル名につける接尾辞 */
  redactSuffix: string;
  /**
   * テンプレートの自動位置合わせを使うか。
   *
   * 有効にすると、テンプレート保存時にそのページの縮小画像 (96px幅・白黒) を
   * 端末内に保存し、適用時のずれの推定に使う。無効なら画像を持たない。
   */
  templateAutoAlign: boolean;
}

export const DPI_CHOICES = [96, 150, 200, 300] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  redactDpi: 150,
  redactFormat: 'jpeg',
  jpegQuality: 0.82,
  defaultRedactColor: 'black',
  thumbnailSize: 'medium',
  organizeSuffix: '_edited',
  redactSuffix: '_redacted',
  templateAutoAlign: true,
};

const KEY = 'settings';

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Settings>;
  const themes: ThemeMode[] = ['system', 'light', 'dark'];
  const sizes: Settings['thumbnailSize'][] = ['small', 'medium', 'large'];
  return {
    theme: themes.includes(value.theme as ThemeMode) ? (value.theme as ThemeMode) : DEFAULT_SETTINGS.theme,
    redactDpi: DPI_CHOICES.includes(value.redactDpi as (typeof DPI_CHOICES)[number])
      ? (value.redactDpi as number)
      : DEFAULT_SETTINGS.redactDpi,
    redactFormat: value.redactFormat === 'png' ? 'png' : 'jpeg',
    jpegQuality:
      typeof value.jpegQuality === 'number' && value.jpegQuality >= 0.3 && value.jpegQuality <= 1
        ? value.jpegQuality
        : DEFAULT_SETTINGS.jpegQuality,
    defaultRedactColor: value.defaultRedactColor === 'white' ? 'white' : 'black',
    thumbnailSize: sizes.includes(value.thumbnailSize as Settings['thumbnailSize'])
      ? (value.thumbnailSize as Settings['thumbnailSize'])
      : DEFAULT_SETTINGS.thumbnailSize,
    organizeSuffix: typeof value.organizeSuffix === 'string' ? value.organizeSuffix : DEFAULT_SETTINGS.organizeSuffix,
    redactSuffix: typeof value.redactSuffix === 'string' ? value.redactSuffix : DEFAULT_SETTINGS.redactSuffix,
    templateAutoAlign:
      typeof value.templateAutoAlign === 'boolean' ? value.templateAutoAlign : DEFAULT_SETTINGS.templateAutoAlign,
  };
}

export function loadSettings(): Settings {
  return coerce(readJson<unknown>(KEY, null));
}

export function saveSettings(settings: Settings): boolean {
  return writeJson(KEY, settings);
}

export const THUMBNAIL_WIDTH_PX: Record<Settings['thumbnailSize'], number> = {
  small: 120,
  medium: 168,
  large: 232,
};
