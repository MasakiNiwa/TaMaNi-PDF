import { redactToPdf } from './redact';
import type { PDFDocumentProxy } from './pdfjs';

/**
 * PDFのファイルサイズを小さくする。
 *
 * やっていることは墨消しとほぼ同じで、「隠す範囲がゼロの墨消し」に等しい。
 * 全ページを指定した解像度で画像にし、画像だけでPDFを組み直す。
 *
 * この作りにしたのは、写真やスキャンで作られた大きなPDFでは、中身のほとんどが
 * 高解像度の画像で占められているため。画像を必要十分な解像度に刷り直すのが、
 * いちばん確実で分かりやすくサイズが落ちる方法になる。
 *
 * 代償は墨消しと同じで、文字は画像になる (検索・選択ができなくなる)。
 * そのため画面では必ずその旨を伝え、小さくならなかったときは
 * 「小さくなりました」と言わないようにしている。
 */

export type CompressLevelId = 'fine' | 'standard' | 'email' | 'tiny';

export interface CompressLevel {
  id: CompressLevelId;
  label: string;
  hint: string;
  /** ラスタライズ解像度 */
  dpi: number;
  /** JPEG の品質 (0〜1) */
  quality: number;
}

/** 画面で選べる強さ (上から順に、きれい→小さい) */
export const COMPRESS_LEVELS: readonly CompressLevel[] = [
  { id: 'fine', label: 'きれいめ', hint: '紙に刷っても粗さが出にくい', dpi: 200, quality: 0.85 },
  { id: 'standard', label: '標準', hint: '画面で読むには十分 (おすすめ)', dpi: 150, quality: 0.72 },
  { id: 'email', label: '小さめ', hint: 'メールや申請フォームの上限に通したいとき', dpi: 110, quality: 0.6 },
  { id: 'tiny', label: 'とにかく小さく', hint: '読めれば良いとき。細かい文字はつぶれる', dpi: 80, quality: 0.45 },
];

export const COMPRESS_LEVEL_BY_ID = new Map(COMPRESS_LEVELS.map((level) => [level.id, level]));

export interface CompressProgress {
  /** 何回目の試行か (目安サイズに収めるときは複数回走る) */
  attempt: number;
  /** 最大で何回試すか */
  attempts: number;
  pageIndex: number;
  pageCount: number;
}

export interface CompressParams {
  bytes: Uint8Array;
  level: CompressLevel;
  proxy?: PDFDocumentProxy;
  onProgress?: (progress: CompressProgress) => void;
  signal?: AbortSignal;
}

/** 指定した強さで1回だけ圧縮する */
export async function compressPdf({
  bytes,
  level,
  proxy,
  onProgress,
  signal,
}: CompressParams): Promise<Uint8Array> {
  return redactToPdf({
    bytes,
    proxy,
    // 隠す範囲は無い。画像化だけを行う。
    rectsForPage: () => [],
    options: { dpi: level.dpi, format: 'jpeg', jpegQuality: level.quality },
    onProgress: ({ pageIndex, pageCount }) =>
      onProgress?.({ attempt: 1, attempts: 1, pageIndex, pageCount }),
    signal,
  });
}

export interface CompressToTargetResult {
  bytes: Uint8Array;
  /** 実際に採用した強さ */
  level: CompressLevel;
  /** 目安のサイズまで下げられたか */
  reached: boolean;
  /** 何回試したか */
  attempts: number;
}

export interface CompressToTargetParams {
  bytes: Uint8Array;
  /** 収めたいサイズ (バイト) */
  targetBytes: number;
  proxy?: PDFDocumentProxy;
  onProgress?: (progress: CompressProgress) => void;
  signal?: AbortSignal;
}

/**
 * 目安のサイズに収まるまで、強さを一段ずつ上げながら試す。
 *
 * 「システムの上限が3MB」のような場面では、dpiや画質を自分で選ぶより
 * 収めたい大きさを言うほうが早い。そのための道。
 *
 * 1回の試行でもページ数ぶんの時間がかかるので、前の結果から
 * どう頑張っても届かない段はとばして、無駄な試行を減らしている。
 */
export async function compressToTarget({
  bytes,
  targetBytes,
  proxy,
  onProgress,
  signal,
}: CompressToTargetParams): Promise<CompressToTargetResult> {
  let best: { bytes: Uint8Array; level: CompressLevel } | null = null;
  let previous: { size: number; level: CompressLevel } | null = null;
  let attempts = 0;

  for (const [index, level] of COMPRESS_LEVELS.entries()) {
    if (previous) {
      // 解像度は面積で効くので二乗、画質はおおむね比例するとみなす。
      // 実際よりも小さめに見積もる式にして、「本当は届いたのにとばした」を防ぐ。
      const optimistic =
        previous.size *
        (level.dpi / previous.level.dpi) ** 2 *
        (level.quality / previous.level.quality);
      if (optimistic > targetBytes && index < COMPRESS_LEVELS.length - 1) continue;
    }

    attempts += 1;
    const attempt = attempts;
    const result = await redactToPdf({
      bytes,
      proxy,
      rectsForPage: () => [],
      options: { dpi: level.dpi, format: 'jpeg', jpegQuality: level.quality },
      onProgress: ({ pageIndex, pageCount }) =>
        onProgress?.({ attempt, attempts: COMPRESS_LEVELS.length, pageIndex, pageCount }),
      signal,
    });

    // いちばん小さかったものを控えておく (どの段でも届かなかったときに返す)
    if (!best || result.byteLength < best.bytes.byteLength) best = { bytes: result, level };
    // 目安に収まっても、元より大きくなっていたら終わりにしない。
    // 「圧縮したのに元より大きいPDF」を渡してしまうため。
    if (result.byteLength <= targetBytes && result.byteLength < bytes.byteLength) {
      return { bytes: result, level, reached: true, attempts };
    }
    previous = { size: result.byteLength, level };
  }

  // ここに来るのは、いちばん強い設定でも目安に届かなかったとき
  const fallback = best ?? { bytes, level: COMPRESS_LEVELS[COMPRESS_LEVELS.length - 1] };
  return { bytes: fallback.bytes, level: fallback.level, reached: false, attempts };
}

/**
 * 文字データをどれくらい持っているPDFかを調べる。
 *
 * 写真やスキャンのPDFは画像化しても失うものが少ないが、
 * ワープロで作ったPDFを画像化すると、検索できなくなるうえに
 * かえって大きくなることもある。先に伝えるために数えておく。
 */
export async function looksTextHeavy(proxy: PDFDocumentProxy): Promise<boolean> {
  const sample = Math.min(3, proxy.numPages);
  let chars = 0;
  for (let index = 0; index < sample; index += 1) {
    const page = await proxy.getPage(index + 1);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item) chars += item.str.trim().length;
    }
    page.cleanup();
  }
  // ばらつきの多い項目だけの書類でも拾えるくらいに低くしておく。
  // 取りこぼすと「検索できなくなる」ことを知らせないまま画像化してしまう。
  return chars / sample > 40;
}
