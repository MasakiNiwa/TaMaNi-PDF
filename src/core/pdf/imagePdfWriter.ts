/**
 * 画像だけでできたPDFを、ページができた順に書き出していく。
 *
 * 墨消し・サイズ圧縮の出力は「1ページ = JPEG画像1枚」という単純な形なので、
 * pdf-lib で文書全体を組み立ててから保存する必要はない。
 * pdf-lib を使うと、全ページの画像を抱えた文書と、保存した結果のバイト列が
 * 同時にメモリに載るため、ページ数の多いPDFでは出力の2倍以上のメモリを使っていた。
 *
 * ここでは、1ページぶんの画像ができるたびにPDFの部品 (画像・描画命令・ページ) を
 * その場で書き、Blob にして手放す。Blob はブラウザが管理する入れ物で、
 * 大きくなるとブラウザがディスクに逃がすこともできる。最後に部品の Blob を
 * つなげて1つのPDFにする (つなげるときに中身の複製は起きない)。
 *
 * PDFの部品はファイルのどこに置いてもよく、ページの順番は最後に書く
 * 「ページの一覧」で決まる。そのため、並べて進めたページが前後して
 * できあがっても、届いた順に書いてよい。
 */

const encoder = new TextEncoder();

/** PDFの数値として書く (小数は4桁まで、余分な0は書かない) */
function num(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/\.?0+$/, '');
}

/** 文字列を UTF-16BE の16進表記にする (情報欄に日本語や記号を入れても壊れないように) */
function textString(value: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i += 1) hex += value.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

export interface JpegPage {
  /** JPEG のバイト列 */
  jpeg: Uint8Array;
  /** 画像の画素数 */
  pixelWidth: number;
  pixelHeight: number;
  /** ページの大きさ (ポイント) */
  width: number;
  height: number;
}

export class ImagePdfWriter {
  /** ページごと・まとまりごとに作った Blob */
  private readonly chunks: Blob[] = [];
  /** これまでに書いたバイト数 (= 次に書く部品の位置) */
  private offset = 0;
  /** 部品の番号ごとの位置 (0番は使わない) */
  private readonly offsets: number[] = [0];
  /** ページ番号 (0始まり) ごとのページ部品の番号 */
  private readonly pages: number[] = [];
  private finished = false;

  /** 1番を目録、2番をページの一覧に予約しておく (最後に書く) */
  private static readonly CATALOG = 1;
  private static readonly PAGES = 2;
  private nextObject = 3;

  constructor(private readonly producer: string) {
    // 2行目の高位バイトの注釈は「このファイルはバイナリを含む」という慣習の印
    const header = new Uint8Array([
      ...encoder.encode('%PDF-1.7\n%'),
      0xe2,
      0xe3,
      0xcf,
      0xd3,
      0x0a,
    ]);
    this.chunks.push(new Blob([header]));
    this.offset = header.byteLength;
    this.offsets[ImagePdfWriter.CATALOG] = 0;
    this.offsets[ImagePdfWriter.PAGES] = 0;
  }

  get pageCount(): number {
    return this.pages.filter((id) => id !== undefined).length;
  }

  /** これまでに書いた大きさ (バイト) */
  get size(): number {
    return this.offset;
  }

  private allocate(): number {
    const id = this.nextObject;
    this.nextObject += 1;
    return id;
  }

  /**
   * 部品をいくつか書いて、1つの Blob にまとめる。
   * 部品ごとの位置を覚えておき、最後の索引 (xref) に使う。
   */
  private write(objects: Array<{ id: number; head: string; stream?: Uint8Array }>): void {
    const parts: BlobPart[] = [];
    for (const object of objects) {
      this.offsets[object.id] = this.offset;
      if (object.stream) {
        const head = encoder.encode(`${object.id} 0 obj\n${object.head}\nstream\n`);
        const tail = encoder.encode('\nendstream\nendobj\n');
        parts.push(head, object.stream as Uint8Array<ArrayBuffer>, tail);
        this.offset += head.byteLength + object.stream.byteLength + tail.byteLength;
      } else {
        const body = encoder.encode(`${object.id} 0 obj\n${object.head}\nendobj\n`);
        parts.push(body);
        this.offset += body.byteLength;
      }
    }
    this.chunks.push(new Blob(parts));
  }

  /** ページ番号 index の位置に、JPEG画像1枚のページを書く (呼ぶ順番は前後してよい) */
  addJpegPage(index: number, page: JpegPage): void {
    if (this.finished) throw new Error('書き出しはもう終わっています。');
    if (this.pages[index] !== undefined) throw new Error(`${index + 1}ページ目は書き出し済みです。`);
    const image = this.allocate();
    const content = this.allocate();
    const pageId = this.allocate();
    const draw = encoder.encode(`q ${num(page.width)} 0 0 ${num(page.height)} 0 0 cm /Im0 Do Q`);
    this.write([
      {
        id: image,
        head:
          `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight}` +
          ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>`,
        stream: page.jpeg,
      },
      { id: content, head: `<< /Length ${draw.byteLength} >>`, stream: draw },
      {
        id: pageId,
        head:
          `<< /Type /Page /Parent ${ImagePdfWriter.PAGES} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}]` +
          ` /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`,
      },
    ]);
    this.pages[index] = pageId;
  }

  /** 最後の部品 (ページの一覧・目録・情報・索引) を書いて、1つのPDFにする */
  finish(): Blob {
    if (this.finished) throw new Error('書き出しはもう終わっています。');
    const kids: number[] = [];
    for (let index = 0; index < this.pages.length; index += 1) {
      const id = this.pages[index];
      if (id === undefined) throw new Error(`${index + 1}ページ目がまだできていません。`);
      kids.push(id);
    }
    if (kids.length === 0) throw new Error('ページがありません。');

    const info = this.allocate();
    this.write([
      {
        id: ImagePdfWriter.PAGES,
        head: `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`,
      },
      { id: ImagePdfWriter.CATALOG, head: `<< /Type /Catalog /Pages ${ImagePdfWriter.PAGES} 0 R >>` },
      {
        id: info,
        head: `<< /Producer ${textString(this.producer)} /Creator ${textString(this.producer)} >>`,
      },
    ]);

    // 索引: 部品ごとの位置を、決まった桁数 (1行20バイト) で並べる
    const total = this.nextObject;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let id = 1; id < total; id += 1) {
      xref += `${String(this.offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    const startXref = this.offset;
    xref +=
      `trailer\n<< /Size ${total} /Root ${ImagePdfWriter.CATALOG} 0 R /Info ${info} 0 R >>\n` +
      `startxref\n${startXref}\n%%EOF\n`;
    const tail = encoder.encode(xref);
    this.chunks.push(new Blob([tail]));
    this.offset += tail.byteLength;
    this.finished = true;
    return new Blob(this.chunks, { type: 'application/pdf' });
  }
}
