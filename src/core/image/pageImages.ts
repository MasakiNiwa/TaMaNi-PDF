import { parallelLanes } from '../perf/device';
import type { PDFDocumentProxy } from '../pdf/pdfjs';
import { canvasToBlob, renderPageToCanvas } from '../pdf/render';
import type { AvifRequest, AvifResponse } from './avif.worker';

/**
 * PDFのページを画像ファイルにする。
 *
 * PNG・JPEG・WebP はブラウザのキャンバスに書き出させる。
 * AVIF はキャンバスでは書き出せないブラウザがほとんどなので、
 * 対応していなければ作業役 (avif.worker.ts) で書き出す。
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export interface ImageFormatInfo {
  label: string;
  mime: string;
  ext: string;
  hint: string;
}

export const IMAGE_FORMATS: Record<ImageFormat, ImageFormatInfo> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', hint: '劣化なし。文字や線がくっきり。大きめ' },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', hint: 'どこでも開ける。写真向き' },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', hint: 'JPEGより小さい。新しめの環境向け' },
  avif: { label: 'AVIF', mime: 'image/avif', ext: 'avif', hint: 'いちばん小さい。書き出しに時間がかかる' },
};

export const IMAGE_FORMAT_ORDER: ImageFormat[] = ['png', 'jpeg', 'webp', 'avif'];

/** 画質 (劣化のある形式だけ)。どれも「見た目では気にならない」くらいに揃えている */
const QUALITY: Record<ImageFormat, number> = { png: 1, jpeg: 0.9, webp: 0.9, avif: 0.62 };

let nativeCache: Promise<Set<ImageFormat>> | null = null;

/**
 * このブラウザのキャンバスが書き出せる形式。
 * 書き出せない形式を頼むと、ブラウザは黙って PNG を返すので、返ってきた種類で確かめる。
 */
export function nativeFormats(): Promise<Set<ImageFormat>> {
  nativeCache ??= (async () => {
    const supported = new Set<ImageFormat>(['png', 'jpeg']);
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext('2d')?.fillRect(0, 0, 2, 2);
    for (const format of ['webp', 'avif'] as const) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, IMAGE_FORMATS[format].mime, 0.8),
      );
      if (blob?.type === IMAGE_FORMATS[format].mime) supported.add(format);
    }
    return supported;
  })();
  return nativeCache;
}

/** 書き出せる形式 (AVIF は作業役でも書き出せるので、作業役と WebAssembly があれば使える) */
export async function availableFormats(): Promise<Set<ImageFormat>> {
  const formats = new Set(await nativeFormats());
  if (typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined') formats.add('avif');
  return formats;
}

// ---------- AVIF の作業役 ----------

let avifWorker: Worker | null = null;
let avifIdle: ReturnType<typeof setTimeout> | null = null;
let avifNextId = 1;
/** 使われないまま、この時間が過ぎたら作業役を片付ける (書き出し器が大きいため) */
const AVIF_IDLE_MS = 60_000;

function encodeAvifInWorker(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('この環境ではキャンバスを利用できません。'));
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  avifWorker ??= new Worker(new URL('./avif.worker.ts', import.meta.url), { type: 'module', name: 'tamani-avif' });
  if (avifIdle) clearTimeout(avifIdle);
  const worker = avifWorker;
  const id = avifNextId++;
  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      avifIdle = setTimeout(() => {
        avifWorker?.terminate();
        avifWorker = null;
      }, AVIF_IDLE_MS);
    };
    const onMessage = (event: MessageEvent<AvifResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(new Blob([event.data.bytes], { type: 'image/avif' }));
      else reject(new Error(event.data.message));
    };
    const onError = () => {
      cleanup();
      avifWorker?.terminate();
      avifWorker = null;
      reject(new Error('AVIF の書き出し器を読み込めませんでした。'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const pixels = data.buffer as ArrayBuffer;
    const request: AvifRequest = { id, width: canvas.width, height: canvas.height, pixels, quality: Math.round(quality * 100) };
    worker.postMessage(request, [pixels]);
  });
}

/** キャンバスを指定の形式の画像にする */
export async function encodeCanvas(canvas: HTMLCanvasElement, format: ImageFormat): Promise<Blob> {
  const native = await nativeFormats();
  const info = IMAGE_FORMATS[format];
  if (native.has(format)) {
    return canvasToBlob(canvas, info.mime, format === 'png' ? undefined : QUALITY[format]);
  }
  if (format === 'avif') return encodeAvifInWorker(canvas, QUALITY.avif);
  throw new Error(`このブラウザは ${info.label} を書き出せません。`);
}

export interface PageImageJob {
  proxy: PDFDocumentProxy;
  /** PDFの中のページ番号 (0始まり) */
  pageIndex: number;
  /** 追加で回す角度 (元ページの回転に足し込まれる) */
  rotation: number;
}

export interface PageImageParams {
  jobs: readonly PageImageJob[];
  dpi: number;
  format: ImageFormat;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * ページを画像にする。結果は jobs と同じ順番で返す。
 * 数ページを同時に流す (端末に合わせた数)。AVIF は作業役が1枚ずつ書き出すので、1ページずつ進める。
 */
export async function renderPageImages({ jobs, dpi, format, onProgress, signal }: PageImageParams): Promise<Blob[]> {
  const results: Blob[] = new Array(jobs.length);
  const lanes = format === 'avif' ? 1 : Math.max(1, Math.min(parallelLanes(), jobs.length));
  let next = 0;
  let done = 0;
  let failed = false;

  const runLane = async () => {
    while (!failed) {
      if (signal?.aborted) throw new DOMException('処理が中止されました。', 'AbortError');
      const index = next;
      if (index >= jobs.length) return;
      next += 1;
      const job = jobs[index];
      try {
        const canvas = await renderPageToCanvas(job.proxy, job.pageIndex, {
          rotation: job.rotation,
          scale: dpi / 72,
          background: '#ffffff',
          signal,
        });
        try {
          results[index] = await encodeCanvas(canvas, format);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      } catch (error) {
        failed = true;
        throw error;
      }
      done += 1;
      onProgress?.(done, jobs.length);
    }
  };

  const settled = await Promise.allSettled(Array.from({ length: lanes }, () => runLane()));
  const rejected = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results;
}
