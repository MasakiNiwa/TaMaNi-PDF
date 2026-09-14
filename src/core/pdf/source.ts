import { PDFDocument } from 'pdf-lib';
import { createId } from '../util/id';
import { toUserError, PdfUserError } from './errors';
import { openWithPdfjs } from './pdfjs';
import type { PageRef, PdfSource } from './types';

/** A4 (ポイント単位) */
export const A4 = { width: 595.28, height: 841.89 } as const;

export const ACCEPTED_PDF_TYPES = ['application/pdf'];
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png)$/i.test(file.name);
}

async function finalizeSource(
  bytes: Uint8Array,
  name: string,
  kind: PdfSource['kind'],
): Promise<{ source: PdfSource; pages: PageRef[] }> {
  const proxy = await openWithPdfjs(bytes);
  const source: PdfSource = {
    id: createId('src'),
    kind,
    name,
    bytes,
    pageCount: proxy.numPages,
    proxy,
    byteLength: bytes.byteLength,
  };
  const pages: PageRef[] = Array.from({ length: proxy.numPages }, (_, index) => ({
    id: createId('pg'),
    sourceId: source.id,
    sourceIndex: index,
    rotation: 0,
  }));
  return { source, pages };
}

/** PDFファイルを読み込んで Source と全ページの参照を作る */
export async function loadPdfFile(file: File): Promise<{ source: PdfSource; pages: PageRef[] }> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await finalizeSource(bytes, file.name, 'pdf');
  } catch (error) {
    throw toUserError(error, file.name);
  }
}

/**
 * 画像を1ページのPDFに変換して読み込む。
 * ページサイズは A4 に収まるよう縦横比を保って拡大縮小する。
 */
export async function loadImageFile(file: File): Promise<{ source: PdfSource; pages: PageRef[] }> {
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.create();
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const image = isPng ? await doc.embedPng(raw) : await doc.embedJpg(raw);

    const landscape = image.width > image.height;
    const boxWidth = landscape ? A4.height : A4.width;
    const boxHeight = landscape ? A4.width : A4.height;
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    const page = doc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    const bytes = await doc.save();
    return await finalizeSource(bytes, file.name, 'image');
  } catch (error) {
    throw toUserError(error, file.name);
  }
}

/** 空白ページを1ページのPDFとして作る */
export async function createBlankSource(
  width = A4.width,
  height = A4.height,
): Promise<{ source: PdfSource; pages: PageRef[] }> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  const bytes = await doc.save();
  return finalizeSource(bytes, '空白ページ', 'blank');
}

/** ドロップ/選択されたファイルを種類ごとに読み込む */
export async function loadAnyFile(file: File): Promise<{ source: PdfSource; pages: PageRef[] }> {
  if (isPdfFile(file)) return loadPdfFile(file);
  if (isImageFile(file)) return loadImageFile(file);
  throw new PdfUserError(`「${file.name}」は対応していない形式です。PDF・JPEG・PNG を選んでください。`);
}
