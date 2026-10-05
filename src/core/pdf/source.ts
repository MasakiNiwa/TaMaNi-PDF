import { PDFDocument } from 'pdf-lib';
import type { ImageImportMode } from '../storage/settings';
import { reencodeInWorker } from '../image/reencode';
import { createId } from '../util/id';
import { toUserError, PdfUserError } from './errors';
import { openWithPdfjs } from './pdfjs';
import { canvasToBlob } from './render';
import type { PageRef, PdfSource } from './types';

/** A4 (ポイント単位) */
export const A4 = { width: 595.28, height: 841.89 } as const;

export const ACCEPTED_PDF_TYPES = ['application/pdf'];
/**
 * 取り込める画像。
 *
 * JPEG と PNG はそのままPDFに埋め込める。WebP・AVIF・HEIC/HEIF はPDFに埋め込めないので、
 * ブラウザに読ませてから JPEG (「元のまま」のときは劣化しない PNG) に描き直して入れる。
 * HEIC/HEIF を読めるのは今のところ Safari (iPhone・Mac) だけで、ほかのブラウザでは
 * 読めない旨を伝える。HEIC を読むための部品 (HEVC の展開器) は特許とライセンスの事情があるため同梱していない。
 */
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
];

/** ファイル選択に渡す accept (拡張子も並べる。HEIC は種類が空で渡ってくる端末があるため) */
export const IMAGE_ACCEPT = [...ACCEPTED_IMAGE_TYPES, '.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif'].join(',');

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name);
}

type ImageKind = 'jpeg' | 'png' | 'other';

function imageKind(file: File): ImageKind {
  if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) return 'jpeg';
  if (file.type === 'image/png' || /\.png$/i.test(file.name)) return 'png';
  return 'other';
}

function isHeic(file: File): boolean {
  return /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/**
 * ブラウザに画像を読ませて、劣化しない PNG に描き直す。
 * PDFにそのまま入れられない形式 (WebP など) を「元のまま」の画質で取り込むときに使う。
 */
async function redrawAsPng(file: File): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  const canvas = document.createElement('canvas');
  try {
    bitmap = await createImageBitmap(file);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
  } catch {
    return null;
  } finally {
    bitmap?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
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
 * 取り込み時に画像を作り直すときの目安。
 *
 * 長辺の上限はA4を300dpi前後で刷れる大きさを基準にした。
 * 「小さめ」は画面で読む・メールで送るには十分で、紙に刷ると少し粗い。
 */
const IMAGE_IMPORT_PRESET: Record<Exclude<ImageImportMode, 'original'>, { maxEdge: number; quality: number }> = {
  balanced: { maxEdge: 2400, quality: 0.82 },
  small: { maxEdge: 1600, quality: 0.68 },
};

/**
 * 画像をブラウザで描き直して JPEG にする。
 *
 * PNGをそのまま埋め込む (pdf-lib の embedPng) のは、PNGの展開をすべて
 * JavaScript で行うため遅い。3MBのPNG1枚で1秒近くかかり、10枚選ぶと待たされる。
 * ブラウザの画像デコーダとキャンバスに任せると、同じことが数分の一の時間で済み、
 * できあがるPDFも小さくなる。
 *
 * 作り直せない環境 (createImageBitmap が無い・壊れた画像) では null を返し、
 * 呼び出し側が元のまま埋め込む道に戻れるようにしている。
 */
async function reencodeImage(
  file: File,
  preset: { maxEdge: number; quality: number },
): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  const canvas = document.createElement('canvas');
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, preset.maxEdge / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    // JPEGは透明を持てないので、透明な部分は白い紙として扱う
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', preset.quality);
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    bitmap?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * 画像を1ページのPDFに変換して読み込む。
 * ページサイズは A4 に収まるよう縦横比を保って拡大縮小する。
 */
export async function loadImageFile(
  file: File,
  mode: ImageImportMode = 'balanced',
): Promise<{ source: PdfSource; pages: PageRef[] }> {
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.create();
    const kind = imageKind(file);

    // 刷り直しは作業役 (Web Worker) に任せる。使えない環境では画面のスレッドで同じことをする。
    const preset = mode === 'original' ? null : IMAGE_IMPORT_PRESET[mode];
    const reencoded = preset
      ? ((await reencodeInWorker(file, preset)) ?? (await reencodeImage(file, preset)))
      : null;

    let image;
    if (kind === 'other') {
      // PDFに直接入れられない形式は、描き直したものしか使えない
      const redrawn = reencoded ?? (mode === 'original' ? await redrawAsPng(file) : null);
      if (!redrawn) {
        throw new PdfUserError(
          isHeic(file)
            ? `「${file.name}」(HEIC) は、このブラウザでは読めません。iPhone・Mac の Safari なら読めます。ほかの端末では、JPEG に変換してから選んでください。`
            : `「${file.name}」は、このブラウザでは読めない画像です。JPEG か PNG に変換してから選んでください。`,
        );
      }
      image = reencoded ? await doc.embedJpg(redrawn) : await doc.embedPng(redrawn);
    } else if (reencoded && reencoded.byteLength < raw.byteLength) {
      // 作り直したほうが大きくなるなら (もともと小さいJPEGなど) 元のまま入れる
      image = await doc.embedJpg(reencoded);
    } else {
      image = kind === 'png' ? await doc.embedPng(raw) : await doc.embedJpg(raw);
    }

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
export async function loadAnyFile(
  file: File,
  imageMode: ImageImportMode = 'balanced',
): Promise<{ source: PdfSource; pages: PageRef[] }> {
  if (isPdfFile(file)) return loadPdfFile(file);
  if (isImageFile(file)) return loadImageFile(file, imageMode);
  throw new PdfUserError(`「${file.name}」は対応していない形式です。PDF か画像 (JPEG・PNG・WebP・AVIF・HEIC) を選んでください。`);
}
