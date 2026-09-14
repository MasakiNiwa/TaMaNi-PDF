/**
 * 墨消しテンプレートと、これから墨消しするPDFを結び付ける部分。
 *
 * align.ts は画像どうしの計算だけを持ち、こちらが pdf.js を使って
 * 「基準画像を作る」「対象ページの画像を作って見比べる」を受け持つ。
 */
import {
  ALIGN_WIDTH,
  decodeFingerprint,
  encodeFingerprint,
  estimateAlignment,
  fingerprintFromCanvas,
  NO_ALIGNMENT,
  type AlignResult,
} from './align';
import type { PDFDocumentProxy } from './pdfjs';
import { renderPageToCanvas } from './render';
import type { RedactTemplate, TemplateAnchor } from '../storage/templates';

/**
 * 目安画像を作るときの描画幅。
 *
 * いきなり96pxで描くと文字がつぶれて運任せになるので、
 * 少し大きく描いてから縮める。
 */
const RENDER_WIDTH = ALIGN_WIDTH * 4;

async function fingerprintOfPage(proxy: PDFDocumentProxy, pageIndex: number) {
  const canvas = await renderPageToCanvas(proxy, pageIndex, {
    targetWidth: RENDER_WIDTH,
    background: '#ffffff',
  });
  const fingerprint = fingerprintFromCanvas(canvas, ALIGN_WIDTH);
  canvas.width = 0;
  canvas.height = 0;
  return fingerprint;
}

/** テンプレート保存時に、基準ページの縮小画像を作る */
export async function capturePageAnchor(proxy: PDFDocumentProxy, pageIndex: number): Promise<TemplateAnchor> {
  const fingerprint = await fingerprintOfPage(proxy, pageIndex);
  return { pageIndex, fingerprint: encodeFingerprint(fingerprint) };
}

/**
 * テンプレートを当てる相手のPDFを見て、ずれを推定する。
 *
 * 基準にしたページと同じ位置のページを見る。相手のページ数が少ないときは
 * 最後のページで代用する (1ページだけ抜き出したPDFなどを想定)。
 */
export async function estimateTemplateAlignment(
  template: RedactTemplate,
  proxy: PDFDocumentProxy,
  enabled: boolean,
): Promise<AlignResult> {
  if (!enabled) return NO_ALIGNMENT;
  if (!template.anchor) return { ...NO_ALIGNMENT, reason: 'noAnchor' };
  const reference = decodeFingerprint(template.anchor.fingerprint);
  if (!reference) return { ...NO_ALIGNMENT, reason: 'noAnchor' };

  const pageIndex = Math.min(template.anchor.pageIndex, proxy.numPages - 1);
  const target = await fingerprintOfPage(proxy, pageIndex);
  return estimateAlignment(reference, target);
}
