import { PDFDocument } from 'pdf-lib';
import { yieldToUi } from '../util/queue';
import { PRODUCER } from './assemble';
import { toUserError } from './errors';
import { closePdf, openWithPdfjs, type PDFDocumentProxy } from './pdfjs';
import { canvasToBlob, clampScale } from './render';

export type RedactColor = 'black' | 'white';

export const REDACT_FILL: Record<RedactColor, string> = {
  black: '#000000',
  white: '#ffffff',
};

/**
 * 墨消し範囲。座標はページに対する 0〜1 の正規化座標で、
 * 原点は左上・x は右方向・y は下方向。
 *
 * 正規化しているのでページサイズが違うPDFにも同じ指定を当てられる。
 * これがテンプレート機能の土台になっている。
 */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RedactColor;
}

export interface RedactOptions {
  /** ラスタライズ解像度 */
  dpi: number;
  format: 'jpeg' | 'png';
  /** JPEG のときだけ使う (0〜1) */
  jpegQuality: number;
}

export const DEFAULT_REDACT_OPTIONS: RedactOptions = {
  dpi: 150,
  format: 'jpeg',
  jpegQuality: 0.82,
};

export interface RedactProgress {
  pageIndex: number;
  pageCount: number;
}

export interface RedactParams {
  bytes: Uint8Array;
  /** ページ番号 (0始まり) ごとの墨消し範囲を返す */
  rectsForPage: (pageIndex: number, pageCount: number) => readonly NormalizedRect[];
  options?: Partial<RedactOptions>;
  onProgress?: (progress: RedactProgress) => void;
  signal?: AbortSignal;
  /** 既に開いてある pdf.js ドキュメントがあれば渡して読み込みを省略できる */
  proxy?: PDFDocumentProxy;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('処理が中止されました。', 'AbortError');
}

/**
 * 全ページを画像化してから墨消しし、画像だけでPDFを組み直す。
 *
 * 「黒い矩形を重ねるだけ」の墨消しは下の文字が残るため、コピーや解析で読めてしまう。
 * ここでは元のページ内容を一度ピクセルに落としてから塗り、塗った結果だけを
 * 新しいPDFに入れるので、隠した部分の情報は出力PDFに残らない。
 *
 * 代償としてテキスト検索・選択はできなくなる (ヘルプで明記している)。
 */
export async function redactToPdf({
  bytes,
  rectsForPage,
  options,
  onProgress,
  signal,
  proxy,
}: RedactParams): Promise<Uint8Array> {
  const settings = { ...DEFAULT_REDACT_OPTIONS, ...options };
  const mime = settings.format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = settings.format === 'png' ? undefined : settings.jpegQuality;

  const doc = proxy ?? (await openWithPdfjs(bytes));
  const out = await PDFDocument.create();
  out.setProducer(PRODUCER);
  out.setCreator(PRODUCER);

  const canvas = document.createElement('canvas');
  const pageCount = doc.numPages;

  try {
    for (let index = 0; index < pageCount; index += 1) {
      assertNotAborted(signal);

      const page = await doc.getPage(index + 1);
      // scale 1 のビューポートが、元ページの回転を反映した最終的な見た目のサイズ (ポイント)
      const base = page.getViewport({ scale: 1 });
      const scale = clampScale(base.width, base.height, settings.dpi / 72);
      const viewport = page.getViewport({ scale });

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('この環境ではキャンバスを利用できません。');

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      page.cleanup();

      // ここで初めて墨消しを適用する。以降このピクセル以外に元データは残らない。
      for (const rect of rectsForPage(index, pageCount)) {
        const x = Math.round(rect.x * canvas.width);
        const y = Math.round(rect.y * canvas.height);
        const w = Math.round(rect.w * canvas.width);
        const h = Math.round(rect.h * canvas.height);
        if (w <= 0 || h <= 0) continue;
        context.fillStyle = REDACT_FILL[rect.color];
        context.fillRect(x, y, w, h);
      }

      const blob = await canvasToBlob(canvas, mime, quality);
      const imageBytes = new Uint8Array(await blob.arrayBuffer());
      const image =
        settings.format === 'png' ? await out.embedPng(imageBytes) : await out.embedJpg(imageBytes);

      // ページの物理サイズは元のまま保つ
      const outPage = out.addPage([base.width, base.height]);
      outPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });

      onProgress?.({ pageIndex: index + 1, pageCount });
      await yieldToUi();
    }

    return await out.save({ useObjectStreams: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw toUserError(error);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    // 呼び出し側から渡されたドキュメントは、その持ち主が閉じる
    if (!proxy) await closePdf(doc);
  }
}
