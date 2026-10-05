/// <reference lib="webworker" />
/**
 * 画像を「読める大きさのJPEG」に刷り直す作業役 (Web Worker)。
 *
 * 画像の展開・縮小・JPEGへの書き出しを、画面とは別のスレッドで行う。
 * 写真を何枚もまとめて取り込んでも、そのあいだ画面の操作が止まらない。
 *
 * 受け取った画像はこの中で処理して返すだけで、どこにも送らない
 * (Worker も同じオリジンのファイルで、CSP の connect-src 'self' の内側にある)。
 */

export interface ReencodeRequest {
  id: number;
  file: Blob;
  maxEdge: number;
  quality: number;
}

export type ReencodeResponse =
  | { id: number; ok: true; bytes: ArrayBuffer }
  | { id: number; ok: false };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<ReencodeRequest>) => {
  const { id, file, maxEdge, quality } = event.data;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('no context');
    // JPEGは透明を持てないので、透明な部分は白い紙として扱う
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const bytes = await blob.arrayBuffer();
    const response: ReencodeResponse = { id, ok: true, bytes };
    scope.postMessage(response, [bytes]);
  } catch {
    const response: ReencodeResponse = { id, ok: false };
    scope.postMessage(response);
  } finally {
    bitmap?.close();
  }
};
