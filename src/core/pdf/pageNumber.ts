/**
 * 書き出すPDFにページ番号を入れる。
 *
 * 元のページ内容には触れず、番号だけを上に描く (文字は文字のまま残る)。
 * 番号に使うのはPDFに標準で備わっている欧文フォントなので、
 * 「ページ」のような日本語は入れられない。書式はすべて欧文と数字で用意している。
 */
import { StandardFonts, degrees, rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';

export type PageNumberFormat = 'plain' | 'dash' | 'slash' | 'pDot';

export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'top-right'
  | 'top-left';

export interface PageNumberOptions {
  format: PageNumberFormat;
  position: PageNumberPosition;
  /** 文字の大きさ (ポイント) */
  size: number;
  /** 最初のページに入れる番号 */
  startAt: number;
  /** 1ページ目を飛ばす (表紙に入れたくないとき) */
  skipFirst: boolean;
  /** 紙の端からの距離 (ポイント) */
  margin: number;
}

export const DEFAULT_PAGE_NUMBER: PageNumberOptions = {
  format: 'plain',
  position: 'bottom-center',
  size: 10,
  startAt: 1,
  skipFirst: false,
  margin: 28,
};

/** 選べる書き方。見本は実際のページ数から作るので、ここでは並び順だけを決める。 */
export const PAGE_NUMBER_FORMATS: PageNumberFormat[] = ['plain', 'dash', 'slash', 'pDot'];

export const PAGE_NUMBER_POSITION_LABEL: Record<PageNumberPosition, string> = {
  'bottom-center': '下 中央',
  'bottom-right': '下 右',
  'bottom-left': '下 左',
  'top-center': '上 中央',
  'top-right': '上 右',
  'top-left': '上 左',
};

export function formatPageNumber(format: PageNumberFormat, current: number, last: number): string {
  switch (format) {
    case 'dash':
      return `- ${current} -`;
    case 'slash':
      return `${current} / ${last}`;
    case 'pDot':
      return `P.${current}`;
    case 'plain':
    default:
      return String(current);
  }
}

/**
 * 「見た目の位置」を実際の座標に直す。
 *
 * 見た目を決めるのは次の2つ。
 *
 * - `/Rotate`: ページは回して表示されることがある。
 *   無視すると横向きのページで番号が横倒しになる。
 * - `/CropBox`: 実際に表示されるのは紙全体ではなく、切り抜かれた範囲のことがある
 *   (トリミング済みPDF)。紙のサイズで位置を決めると、番号が表示範囲の外に出てしまう。
 */
function place(
  page: PDFPage,
  position: PageNumberPosition,
  textWidth: number,
  size: number,
  margin: number,
): { x: number; y: number; rotate: number } {
  // 表示される範囲。ない場合は紙全体が返る。
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const quarter = rotation === 90 || rotation === 270;

  // 見た目の大きさ (回すと縦横が入れ替わる)
  const viewWidth = quarter ? box.height : box.width;
  const viewHeight = quarter ? box.width : box.height;

  // 見た目の上での置きたい場所 (表示範囲の左下が原点)
  const isTop = position.startsWith('top');
  const viewY = isTop ? viewHeight - margin - size : margin;
  const viewX = position.endsWith('center')
    ? (viewWidth - textWidth) / 2
    : position.endsWith('right')
      ? viewWidth - margin - textWidth
      : margin;

  // 回転を戻して、表示範囲の左下からの位置にする
  const local = (() => {
    switch (rotation) {
      case 90:
        // 見た目の右 = 実際の上、見た目の上 = 実際の左
        return { x: box.width - viewY, y: viewX };
      case 180:
        return { x: box.width - viewX, y: box.height - viewY };
      case 270:
        return { x: viewY, y: box.height - viewX };
      case 0:
      default:
        return { x: viewX, y: viewY };
    }
  })();

  // 最後に、表示範囲の原点ぶんだけずらす (紙の左下と表示範囲の左下は一致しない)
  return { x: box.x + local.x, y: box.y + local.y, rotate: rotation };
}

/**
 * 出来上がったPDFの各ページに番号を描く。
 *
 * 番号は「飛ばしたページを除いた通し番号」で、開始番号から数える。
 */
export async function drawPageNumbers(doc: PDFDocument, options: PageNumberOptions): Promise<void> {
  const pages = doc.getPages();
  const numbered = pages.length - (options.skipFirst ? 1 : 0);
  if (numbered <= 0) return;

  const font: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  const last = options.startAt + numbered - 1;

  pages.forEach((page, index) => {
    if (options.skipFirst && index === 0) return;
    const current = options.startAt + index - (options.skipFirst ? 1 : 0);
    const text = formatPageNumber(options.format, current, last);
    const textWidth = font.widthOfTextAtSize(text, options.size);
    const { x, y, rotate } = place(page, options.position, textWidth, options.size, options.margin);
    page.drawText(text, {
      x,
      y,
      size: options.size,
      font,
      color: rgb(0.15, 0.15, 0.15),
      rotate: degrees(rotate),
    });
  });
}
