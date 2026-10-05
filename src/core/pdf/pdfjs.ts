import '../polyfills';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// polyfill を通したワーカーを使う (素の pdf.worker を直接指すと
// Map の upsert メソッドが無いブラウザで描画に失敗する)
import workerUrl from './pdf.worker.entry?worker&url';
import { useGpu } from '../perf/device';

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
  /** GPUで描くか。省略すると設定に従う (速さの計測では組み合わせごとに指定する) */
  gpu?: boolean;
}

/**
 * 開いたときに GPU で描く設定だったか。
 * pdf.js の GPU の使い方 (enableHWA) は開くときに決まり、あとから変えられないため覚えておく。
 */
const openedWithGpu = new WeakMap<PDFDocumentProxy, boolean>();

export function gpuOf(proxy: PDFDocumentProxy): boolean | undefined {
  return openedWithGpu.get(proxy);
}

/** ファイルから読み込むときの1回分の大きさ (pdf.js が必要な部分だけを順に取りに来る) */
const RANGE_CHUNK = 1 << 20;

/**
 * ファイル (Blob) を、pdf.js が必要とする部分だけ切り出して渡す。
 *
 * バイト列で渡すと、ファイル全体をいったん画面側のメモリに読み込み、さらに
 * pdf.js へ渡すための複製を作る (ファイルの大きさの2倍が画面側に載る)。
 * こちらは、pdf.js の作業役が「この範囲をください」と言ってきたときに
 * ファイルのその部分だけを読んで渡すので、画面側には読み込み途中の一部しか載らない。
 * 読みに行く先は端末の中のファイルで、ネットワークには出ない。
 */
class BlobRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  private aborted = false;
  private rejectFailure: (error: Error) => void = () => undefined;

  /**
   * 部分的に読めなかったときに失敗する約束。
   *
   * pdf.js には「この範囲は読めなかった」と伝える道がなく、黙っていると
   * 読み込みがいつまでも終わらない。そこで、こちらで失敗を受け取れるようにして、
   * 開く処理と競わせる (読めなければ、ファイル全体の読み込みに切り替える)。
   */
  readonly failure: Promise<never>;

  constructor(private readonly blob: Blob) {
    super(blob.size, null);
    this.failure = new Promise<never>((_, reject) => {
      this.rejectFailure = reject;
    });
    // 誰も待っていないときに「処理されなかった失敗」として騒がれないようにする
    this.failure.catch(() => undefined);
  }

  override requestDataRange(begin: number, end: number): void {
    void this.blob
      .slice(begin, end)
      .arrayBuffer()
      .then((buffer) => {
        if (!this.aborted) this.onDataRange(begin, new Uint8Array(buffer));
      })
      .catch((error: unknown) => {
        if (this.aborted) return;
        this.rejectFailure(error instanceof Error ? error : new Error('ファイルの一部を読めませんでした。'));
      });
  }

  override abort(): void {
    this.aborted = true;
  }
}

/**
 * PDFDocumentProxy を得る。
 *
 * - Blob (選ばれたファイルや、作ったPDF) は、必要な部分だけを順に渡す (BlobRangeTransport)
 * - バイト列は、pdf.js が中身を手放させる (detach する) ため複製して渡す。
 *   呼び出し側は元のバイト列を pdf-lib 側でも使い続けられる。
 */
export async function openWithPdfjs(
  source: Uint8Array | Blob,
  options: LoadOptions = {},
): Promise<PDFDocumentProxy> {
  if (!(source instanceof Blob)) return open(source, options);
  try {
    return await open(source, options);
  } catch (error) {
    // パスワードが要るPDFは、読み方を変えても結果は同じなのでそのまま返す
    if ((error as { name?: string } | null)?.name === 'PasswordException') throw error;
    // クラウドのファイルなど、あとから部分的に読み直せないものがある。
    // そのときは、これまでどおりファイル全体を読み込んでから開く。
    return open(new Uint8Array(await source.arrayBuffer()), options);
  }
}

async function open(source: Uint8Array | Blob, options: LoadOptions): Promise<PDFDocumentProxy> {
  const transport = source instanceof Blob ? new BlobRangeTransport(source) : null;
  const input =
    source instanceof Blob && transport
      ? {
          range: transport,
          length: source.size,
          rangeChunkSize: RANGE_CHUNK,
          // 先読みで全体を取りに行かない (必要になったページの分だけ読む)
          disableAutoFetch: true,
          disableStream: true,
        }
      : { data: (source as Uint8Array).slice() };
  const gpu = options.gpu ?? useGpu();
  const task = pdfjsLib.getDocument({
    ...input,
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    // PDF内に埋め込まれたスクリプトやXFAフォームは解釈しない。
    // pdf.js はスクリプト実行を明示的に有効化しない限り走らせないため、
    // ここでは XFA を切って描画経路を素のPDFだけに絞っている。
    enableXfa: false,
    // GPUで描けるなら、pdf.js が内部で使う作業用の描画面もGPU側に置く。
    // 使わない設定のときは全部CPU側に揃える (行き来の手間が出ないように)。
    enableHWA: gpu,
    password: options.password,
  });
  try {
    const proxy = transport ? await Promise.race([task.promise, transport.failure]) : await task.promise;
    openedWithGpu.set(proxy, gpu);
    return proxy;
  } catch (error) {
    // 開けなかった読み込みは、作業役ごと片付ける (残しておくと、読み込み待ちのまま居座る)
    void task.destroy().catch(() => undefined);
    throw error;
  }
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
