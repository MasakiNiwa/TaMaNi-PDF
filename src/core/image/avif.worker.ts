/// <reference lib="webworker" />
/**
 * AVIF への書き出しを受け持つ作業役 (Web Worker)。
 *
 * ブラウザのキャンバスは AVIF を書き出せない (頼んでも黙って PNG が返ってくる) ので、
 * Squoosh (Google Chrome チーム) の AVIF 書き出し器 (@jsquash/avif、Apache-2.0) を使う。
 * 1枚に数秒かかる重い処理なので、画面とは別のスレッドで行う。
 *
 * 書き出し器の本体 (wasm, 約3.4MB) は同じオリジンから読み込み、AVIF を選んだときにだけ取りに行く。
 * GitHub Pages では複数スレッド版を使える条件 (cross-origin isolation) を満たせないため、
 * 1スレッド版だけを直接読み込む (使わない複数スレッド版を同梱しないため)。
 */
import avifEncoder from '@jsquash/avif/codec/enc/avif_enc.js';
import { defaultOptions } from '@jsquash/avif/meta.js';
import { initEmscriptenModule } from '@jsquash/avif/utils.js';

export interface AvifRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA の画素 (幅 × 高さ × 4) */
  pixels: ArrayBuffer;
  /** 0〜100 */
  quality: number;
}

export type AvifResponse = { id: number; ok: true; bytes: ArrayBuffer } | { id: number; ok: false; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let module: Promise<any> | null = null;

scope.onmessage = async (event: MessageEvent<AvifRequest>) => {
  const { id, width, height, pixels, quality } = event.data;
  try {
    module ??= initEmscriptenModule(avifEncoder, undefined);
    const encoder = await module;
    const output: Uint8Array | null = encoder.encode(new Uint8Array(pixels), width, height, {
      ...defaultOptions,
      quality,
    });
    if (!output) throw new Error('AVIF にできませんでした。');
    const bytes = output.slice().buffer;
    const response: AvifResponse = { id, ok: true, bytes };
    scope.postMessage(response, [bytes]);
  } catch (error) {
    const response: AvifResponse = {
      id,
      ok: false,
      message: error instanceof Error ? error.message : 'AVIF にできませんでした。',
    };
    scope.postMessage(response);
  }
};
