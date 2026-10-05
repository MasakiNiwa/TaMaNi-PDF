import { PDFDocument } from 'pdf-lib';
import { yieldToUi } from '../util/queue';
import { PRODUCER } from './assemble';
import { toUserError } from './errors';
import { context2d, parallelLanes } from '../perf/device';
import { ImagePdfWriter } from './imagePdfWriter';
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
  /**
   * 元のPDF。ファイル (Blob) で渡すと、必要な部分だけを順に読む。
   * proxy を渡したときは使わない。
   */
  source: Uint8Array | Blob;
  /** ページ番号 (0始まり) ごとの墨消し範囲を返す */
  rectsForPage: (pageIndex: number, pageCount: number) => readonly NormalizedRect[];
  options?: Partial<RedactOptions>;
  onProgress?: (progress: RedactProgress) => void;
  signal?: AbortSignal;
  /** 既に開いてある pdf.js ドキュメントがあれば渡して読み込みを省略できる */
  proxy?: PDFDocumentProxy;
  /**
   * 同時に何ページ進めるか。省略すると端末に合わせて決める (perf/device.ts)。
   * 1 にすると、これまでどおり1ページずつ順番に進める。
   */
  lanes?: number;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('処理が中止されました。', 'AbortError');
}

/** 1ページぶんの仕上がり (画像と、元ページの大きさ) */
interface RasterPage {
  image: Uint8Array;
  /** 画像の画素数 */
  pixelWidth: number;
  pixelHeight: number;
  /** 元ページの大きさ (ポイント) */
  width: number;
  height: number;
}

/**
 * 1ページを画像にして、墨消しを塗り、JPEG/PNG にする。
 */
async function rasterizePage(
  doc: PDFDocumentProxy,
  index: number,
  pageCount: number,
  canvas: HTMLCanvasElement,
  settings: RedactOptions,
  rectsForPage: RedactParams['rectsForPage'],
): Promise<RasterPage> {
  const mime = settings.format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = settings.format === 'png' ? undefined : settings.jpegQuality;

  const page = await doc.getPage(index + 1);
  // scale 1 のビューポートが、元ページの回転を反映した最終的な見た目のサイズ (ポイント)
  const base = page.getViewport({ scale: 1 });
  const scale = clampScale(base.width, base.height, settings.dpi / 72);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = context2d(canvas);
  if (!context) throw new Error('この環境ではキャンバスを利用できません。');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise;
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
  return {
    image: new Uint8Array(await blob.arrayBuffer()),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    width: base.width,
    height: base.height,
  };
}

/**
 * 全ページを画像化してから墨消しし、画像だけでPDFを組み直す。
 *
 * 「黒い矩形を重ねるだけ」の墨消しは下の文字が残るため、コピーや解析で読めてしまう。
 * ここでは元のページ内容を一度ピクセルに落としてから塗り、塗った結果だけを
 * 新しいPDFに入れるので、隠した部分の情報は出力PDFに残らない。
 *
 * 代償としてテキスト検索・選択はできなくなる (ヘルプで明記している)。
 *
 * ## 並べて進める
 *
 * 1つのページの仕上げには、3つの持ち場がある。
 *   1. PDFの解釈と埋め込み画像の展開 … pdf.js の作業役 (Web Worker)
 *   2. キャンバスへの描画           … 画面のスレッド
 *   3. JPEG への書き出し             … ブラウザの画像処理スレッド
 * 1ページずつだと、どれか1つが動いているあいだ残りの2つは待っている。
 * そこで数ページを同時に流し (レーン)、あるページを描いているあいだに
 * 次のページの解釈と、前のページの書き出しが進むようにしている。
 *
 * レーンごとにPDFを開き直して作業役を増やす形も試したが、開き直す手間のほうが大きく、
 * 4コアの端末ではかえって遅かった (docs/SPEC.md の計測を参照)。
 * そのため作業役は1つのまま、流すページの数だけを増やしている。
 *
 * ## 少しずつ書き出す
 *
 * JPEG のときは、ページができるたびに ImagePdfWriter でPDFの部品として書き、
 * 手元には持たない。全ページを抱えてから組み立てる形だと、ページ数の多いPDFで
 * 出力の何倍ものメモリを使うため。出力は Blob で返す。
 * PNG のとき (設定で選んだ場合だけ) は、PNG をPDFの形に直す処理を pdf-lib に任せるため、
 * これまでどおり全ページそろえてから組み立てる。
 */
export async function redactToPdf({
  source,
  rectsForPage,
  options,
  onProgress,
  signal,
  proxy,
  lanes,
}: RedactParams): Promise<Blob> {
  const settings = { ...DEFAULT_REDACT_OPTIONS, ...options };
  const streaming = settings.format === 'jpeg';

  const doc = proxy ?? (await openWithPdfjs(source));
  const pageCount = doc.numPages;
  const laneCount = Math.max(1, Math.min(lanes ?? parallelLanes(), pageCount));
  const canvases: HTMLCanvasElement[] = [];

  try {
    const writer = streaming ? new ImagePdfWriter(PRODUCER) : null;
    // PNG のときだけ、組み立てまで手元に置いておく
    const pending: RasterPage[] = [];
    let next = 0;
    let done = 0;
    // どれか1つのレーンが失敗したら、ほかのレーンも新しいページを取らずに止める
    let failed = false;

    const runLane = async () => {
      const canvas = document.createElement('canvas');
      canvases.push(canvas);
      while (!failed) {
        assertNotAborted(signal);
        const index = next;
        if (index >= pageCount) return;
        next += 1;
        try {
          const result = await rasterizePage(doc, index, pageCount, canvas, settings, rectsForPage);
          if (writer) {
            writer.addJpegPage(index, {
              jpeg: result.image,
              pixelWidth: result.pixelWidth,
              pixelHeight: result.pixelHeight,
              width: result.width,
              height: result.height,
            });
          } else {
            pending[index] = result;
          }
        } catch (error) {
          failed = true;
          throw error;
        }
        done += 1;
        onProgress?.({ pageIndex: done, pageCount });
        await yieldToUi();
      }
    };

    // 全レーンが止まるまで待ってから後始末に進む (描いている途中で閉じないように)
    const settled = await Promise.allSettled(Array.from({ length: laneCount }, () => runLane()));
    const rejected = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (rejected) throw rejected.reason;
    assertNotAborted(signal);

    if (writer) return writer.finish();

    const out = await PDFDocument.create();
    out.setProducer(PRODUCER);
    out.setCreator(PRODUCER);
    for (const result of pending) {
      const image = await out.embedPng(result.image);
      // ページの物理サイズは元のまま保つ
      const outPage = out.addPage([result.width, result.height]);
      outPage.drawImage(image, { x: 0, y: 0, width: result.width, height: result.height });
    }
    const bytes = await out.save({ useObjectStreams: true });
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw toUserError(error);
  } finally {
    for (const canvas of canvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
    // 呼び出し側から渡されたドキュメントは、その持ち主が閉じる
    if (!proxy) await closePdf(doc);
  }
}
