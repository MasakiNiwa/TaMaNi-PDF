import '../polyfills';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// polyfill を通したワーカーを使う (素の pdf.worker を直接指すと
// Map の upsert メソッドが無いブラウザで描画に失敗する)
import workerUrl from './pdf.worker.entry?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * pdf.js の補助アセット (CMap / 標準フォント / wasm / ICC) はすべて同一オリジンから配信する。
 * CDN を使わないので、CSP の connect-src を 'self' に閉じたままにできる。
 * scripts/copy-pdfjs-assets.mjs が public/pdfjs/ に配置している。
 */
function assetUrl(path: string): string {
  return new URL(`pdfjs/${path}`, document.baseURI).href;
}

export interface LoadOptions {
  /** パスワード付きPDFのパスワード */
  password?: string;
}

/**
 * バイト列から PDFDocumentProxy を得る。
 *
 * pdf.js は渡された ArrayBuffer の所有権を奪う (detach する) ため、必ずコピーを渡す。
 * 呼び出し側は元のバイト列を pdf-lib 側でも使い続けられる。
 */
export async function openWithPdfjs(bytes: Uint8Array, options: LoadOptions = {}): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    // PDF内に埋め込まれたスクリプトやXFAフォームは解釈しない。
    // pdf.js はスクリプト実行を明示的に有効化しない限り走らせないため、
    // ここでは XFA を切って描画経路を素のPDFだけに絞っている。
    enableXfa: false,
    password: options.password,
  });
  return task.promise;
}

/**
 * pdf.js のドキュメントとワーカー側の資源を解放する。
 * PDFDocumentProxy 自体に destroy はないので、読み込みタスク経由で閉じる。
 */
export async function closePdf(proxy: PDFDocumentProxy | null | undefined): Promise<void> {
  if (!proxy) return;
  try {
    await proxy.loadingTask.destroy();
  } catch {
    /* 既に閉じている場合は何もしない */
  }
}

export { pdfjsLib };
export type { PDFDocumentProxy };
