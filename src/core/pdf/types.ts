import type { PDFDocumentProxy } from './pdfjs';

/** 90度単位の回転量 */
export type Rotation = 0 | 90 | 180 | 270;

export type SourceKind = 'pdf' | 'image' | 'blank';

/**
 * ページの供給元。
 *
 * 画像や空白ページも読み込んだ時点で「1ページのPDF」に変換して Source として扱う。
 * これによりページ操作のロジックを1種類に統一でき、後から供給元の種類を増やしやすい。
 */
export interface PdfSource {
  id: string;
  kind: SourceKind;
  /** 表示用の名前 (元のファイル名など) */
  name: string;
  /** 元のPDFバイト列。pdf-lib での組み立てに使う */
  bytes: Uint8Array;
  pageCount: number;
  /** サムネイル描画用の pdf.js ドキュメント */
  proxy: PDFDocumentProxy;
  /** 元ファイルのバイト数 (表示用) */
  byteLength: number;
}

/**
 * 出力PDFを構成する1ページ分の指定。
 * 元のページを指すだけの軽い値なので、並べ替え・複製・Undo を安く実装できる。
 */
export interface PageRef {
  id: string;
  sourceId: string;
  /** 供給元PDFの中でのページ番号 (0始まり) */
  sourceIndex: number;
  /** 元ページの向きに対して追加で回す角度 */
  rotation: Rotation;
}

export function normalizeRotation(angle: number): Rotation {
  const value = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return value as Rotation;
}
