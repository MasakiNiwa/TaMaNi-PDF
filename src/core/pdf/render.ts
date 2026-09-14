import { createLimiter } from '../util/queue';
import type { PDFDocumentProxy } from './pdfjs';

/** ブラウザが扱えるキャンバスの上限に対する安全側の目安 */
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 24_000_000;

/** pdf.js のワーカーを詰まらせないよう、サムネイル描画の同時実行数を絞る */
const renderLimiter = createLimiter(3);

export interface PageSize {
  /** ポイント単位 (元ページの回転を反映済み) */
  width: number;
  height: number;
}

export async function getPageSize(proxy: PDFDocumentProxy, pageIndex: number): Promise<PageSize> {
  const page = await proxy.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/** 指定された倍率がキャンバス上限を超えないように丸める */
export function clampScale(width: number, height: number, scale: number): number {
  let result = scale;
  const sideLimit = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
  result = Math.min(result, sideLimit);
  const pixelLimit = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  return Math.max(0.05, Math.min(result, pixelLimit));
}

export interface RenderToCanvasOptions {
  /** 追加の回転量 (元ページの回転に足し込まれる) */
  rotation?: number;
  /** 出力キャンバスの目標幅 (px)。指定するとこの幅に合わせて倍率を決める */
  targetWidth?: number;
  /** 目標幅の代わりに使う倍率 */
  scale?: number;
  canvas?: HTMLCanvasElement;
  background?: string;
  /** 途中で不要になったときに描画を打ち切るための合図 */
  signal?: AbortSignal;
}

/** 1ページをキャンバスへ描画する */
export async function renderPageToCanvas(
  proxy: PDFDocumentProxy,
  pageIndex: number,
  options: RenderToCanvasOptions = {},
): Promise<HTMLCanvasElement> {
  return renderLimiter(async () => {
    if (options.signal?.aborted) throw new DOMException('描画が不要になりました。', 'AbortError');
    const page = await proxy.getPage(pageIndex + 1);
    const rotation = (((page.rotate + (options.rotation ?? 0)) % 360) + 360) % 360;
    const base = page.getViewport({ scale: 1, rotation });

    let scale = options.scale ?? (options.targetWidth ? options.targetWidth / base.width : 1);
    scale = clampScale(base.width, base.height, scale);

    const viewport = page.getViewport({ scale, rotation });
    const canvas = options.canvas ?? document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('この環境ではキャンバスを利用できません。');
    context.fillStyle = options.background ?? '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({ canvas, viewport, background: options.background ?? '#ffffff' });
    // 表示倍率が次々変わるときは、前の描画を打ち切ってから次を描く。
    // 同じキャンバスに二重に描くと、pdf.js が途中状態のまま壊れた絵を残す。
    const onAbort = () => task.cancel();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
    page.cleanup();
    return canvas;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像の生成に失敗しました。'))),
      mime,
      quality,
    );
  });
}

/**
 * サムネイル用の Blob URL を作って使い回すキャッシュ。
 *
 * 回転はCSSで見せるためキャッシュキーに含めない (回すたびに再描画しないで済む)。
 * すべてブラウザ内の Blob URL で、ネットワークには一切出ない。
 */
export class ThumbnailCache {
  private readonly entries = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly limit = 400) {}

  private static key(sourceId: string, pageIndex: number, width: number): string {
    return `${sourceId}:${pageIndex}:${width}`;
  }

  get(sourceId: string, pageIndex: number, width: number): string | undefined {
    return this.entries.get(ThumbnailCache.key(sourceId, pageIndex, width));
  }

  async load(proxy: PDFDocumentProxy, sourceId: string, pageIndex: number, width: number): Promise<string> {
    const key = ThumbnailCache.key(sourceId, pageIndex, width);
    const cached = this.entries.get(key);
    if (cached) return cached;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const task = (async () => {
      const canvas = await renderPageToCanvas(proxy, pageIndex, { targetWidth: width });
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.72);
      const url = URL.createObjectURL(blob);
      // キャンバスを最小化して GC を助ける
      canvas.width = 0;
      canvas.height = 0;
      this.evictIfNeeded();
      this.entries.set(key, url);
      this.pending.delete(key);
      return url;
    })();

    this.pending.set(key, task);
    return task;
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const url = this.entries.get(oldest.value);
      if (url) URL.revokeObjectURL(url);
      this.entries.delete(oldest.value);
    }
  }

  /** 指定した供給元のサムネイルを破棄する */
  dropSource(sourceId: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${sourceId}:`)) {
        const url = this.entries.get(key);
        if (url) URL.revokeObjectURL(url);
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    for (const url of this.entries.values()) URL.revokeObjectURL(url);
    this.entries.clear();
    this.pending.clear();
  }
}
