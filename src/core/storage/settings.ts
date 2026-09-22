import type { RedactColor } from '../pdf/redact';
import { readJson, writeJson } from './store';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * 画像をPDFに取り込むときの扱い。
 *
 * 'original' は元の画像をそのまま埋め込む (画質はそのまま・遅い・大きい)。
 * ほかの2つはブラウザで一度描き直してからJPEGにするので、取り込みが速く、
 * できるPDFも小さい。スマホで撮った写真やスクリーンショットはこちらで十分。
 */
export type ImageImportMode = 'original' | 'balanced' | 'small';

export interface Settings {
  theme: ThemeMode;
  /** 墨消し時のラスタライズ解像度 */
  redactDpi: number;
  redactFormat: 'jpeg' | 'png';
  jpegQuality: number;
  defaultRedactColor: RedactColor;
  /** ページ一覧のサムネイルの大きさ (整理画面でその場でも変えられる) */
  thumbnailSize: 'small' | 'medium' | 'large' | 'xlarge';
  /**
   * PDFを追加するときに、入れるページを選ぶか。
   *
   * 'choose' は追加前に中身を見せて選ばせる。'all' は確認なしで全ページ入れる。
   * すでにページがある状態での追加にだけ効く (最初の読み込みは常に全ページ)。
   */
  addPagesMode: 'choose' | 'all';
  /**
   * 画像 (PNG/JPEG) をページとして取り込むときの画質。
   *
   * 既定は 'balanced'。PNGをそのまま埋め込むと、取り込みに時間がかかるうえ
   * PDFが元画像のまま大きくなるため、ふつうに読める範囲で軽くしておく。
   */
  imageImport: ImageImportMode;
  /** ページ整理の出力ファイル名につける接尾辞 */
  organizeSuffix: string;
  /** 墨消しの出力ファイル名につける接尾辞 */
  redactSuffix: string;
  /** サイズ圧縮の出力ファイル名につける接尾辞 */
  compressSuffix: string;
  /**
   * テンプレートの自動位置合わせを使うか。
   *
   * 有効にすると、テンプレート保存時にそのページの縮小画像 (96px幅・白黒) を
   * 端末内に保存し、適用時のずれの推定に使う。無効なら画像を持たない。
   *
   * 既定は無効。保存するものが座標だけで済むほうが、初めて使う人にとって
   * 安心できる既定だと考えたため。必要な人が設定で有効にする。
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
  addPagesMode: 'choose',
  imageImport: 'balanced',
  organizeSuffix: '_edited',
  redactSuffix: '_redacted',
  compressSuffix: '_small',
  templateAutoAlign: false,
};

const KEY = 'settings';

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Settings>;
  const themes: ThemeMode[] = ['system', 'light', 'dark'];
  const sizes: Settings['thumbnailSize'][] = ['small', 'medium', 'large', 'xlarge'];
  const imageModes: ImageImportMode[] = ['original', 'balanced', 'small'];
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
    addPagesMode: value.addPagesMode === 'all' ? 'all' : DEFAULT_SETTINGS.addPagesMode,
    imageImport: imageModes.includes(value.imageImport as ImageImportMode)
      ? (value.imageImport as ImageImportMode)
      : DEFAULT_SETTINGS.imageImport,
    organizeSuffix: typeof value.organizeSuffix === 'string' ? value.organizeSuffix : DEFAULT_SETTINGS.organizeSuffix,
    redactSuffix: typeof value.redactSuffix === 'string' ? value.redactSuffix : DEFAULT_SETTINGS.redactSuffix,
    compressSuffix:
      typeof value.compressSuffix === 'string' ? value.compressSuffix : DEFAULT_SETTINGS.compressSuffix,
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
  // 中身を読んで確かめたいとき用。1行に並ぶ枚数は減る。
  xlarge: 340,
};

/** 小さいほうから並べた一覧 (画面でひとつずつ動かすのに使う) */
export const THUMBNAIL_SIZES: Settings['thumbnailSize'][] = ['small', 'medium', 'large', 'xlarge'];

export const THUMBNAIL_SIZE_LABEL: Record<Settings['thumbnailSize'], string> = {
  small: '小',
  medium: '中',
  large: '大',
  xlarge: '特大',
};

export const IMAGE_IMPORT_LABEL: Record<ImageImportMode, string> = {
  original: '元のまま',
  balanced: 'ほどほど (既定)',
  small: '小さめ',
};
