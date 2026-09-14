import { PDFDocument, degrees } from 'pdf-lib';
import { toUserError } from './errors';
import { normalizeRotation, type PageRef, type PdfSource } from './types';

export const PRODUCER = 'TaMaNi-PDF';

/**
 * ページ参照の並びから1つのPDFを組み立てる。
 *
 * 元ページの内容はそのままコピーするので、文字は文字のまま残る (再ラスタライズしない)。
 * 同じ供給元からのコピーは1回の copyPages にまとめてから順番に並べ直している。
 */
export async function buildPdfFromPages(
  sources: ReadonlyMap<string, PdfSource>,
  pages: readonly PageRef[],
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error('出力するページがありません。');
  }

  const out = await PDFDocument.create();
  out.setProducer(PRODUCER);
  out.setCreator(PRODUCER);

  // 供給元ごとに必要なページ番号を順番どおりに集める
  const indicesBySource = new Map<string, number[]>();
  for (const page of pages) {
    const list = indicesBySource.get(page.sourceId);
    if (list) list.push(page.sourceIndex);
    else indicesBySource.set(page.sourceId, [page.sourceIndex]);
  }

  const copiedBySource = new Map<string, Awaited<ReturnType<PDFDocument['copyPages']>>>();
  for (const [sourceId, indices] of indicesBySource) {
    const source = sources.get(sourceId);
    if (!source) throw new Error('読み込み済みのファイルが見つかりませんでした。');
    try {
      const doc = await PDFDocument.load(source.bytes, { updateMetadata: false });
      copiedBySource.set(sourceId, await out.copyPages(doc, indices));
    } catch (error) {
      throw toUserError(error, source.name);
    }
  }

  const cursors = new Map<string, number>();
  for (const page of pages) {
    const copied = copiedBySource.get(page.sourceId);
    if (!copied) throw new Error('ページのコピーに失敗しました。');
    const cursor = cursors.get(page.sourceId) ?? 0;
    cursors.set(page.sourceId, cursor + 1);

    const copiedPage = copied[cursor];
    if (page.rotation !== 0) {
      copiedPage.setRotation(degrees(normalizeRotation(copiedPage.getRotation().angle + page.rotation)));
    }
    out.addPage(copiedPage);
  }

  return out.save({ useObjectStreams: true });
}
