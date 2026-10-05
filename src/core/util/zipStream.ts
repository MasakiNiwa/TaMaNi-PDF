import { Zip, ZipPassThrough } from 'fflate';

/**
 * いくつかのファイル (Blob) を、少しずつ読みながら1つの ZIP にまとめる。
 *
 * 以前は全ファイルを1つのバイト列にしてから ZIP を作っていたため、
 * 出来上がりのPDFの合計の2倍以上のメモリを一度に使っていた。
 * ここでは各ファイルを少しずつ読んで ZIP の部品にし、部品は Blob にして手放す。
 *
 * PDFはもともと圧縮されているので、ZIP では圧縮し直さずに格納だけする (ZipPassThrough)。
 */

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** 部品をこのくらい貯めたら Blob にまとめて手放す */
const FLUSH_BYTES = 8 * 1024 * 1024;

export async function zipBlobs(entries: readonly ZipEntry[]): Promise<Blob> {
  const blobs: Blob[] = [];
  let buffered: Uint8Array<ArrayBuffer>[] = [];
  let bufferedBytes = 0;
  const flush = () => {
    if (buffered.length === 0) return;
    blobs.push(new Blob(buffered));
    buffered = [];
    bufferedBytes = 0;
  };

  let fail: (error: unknown) => void = () => undefined;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      fail(error);
      return;
    }
    // fflate が使い回すことのある領域を参照しないよう、写してから持つ
    buffered.push(chunk.slice() as Uint8Array<ArrayBuffer>);
    bufferedBytes += chunk.byteLength;
    if (bufferedBytes >= FLUSH_BYTES) flush();
    if (final) {
      flush();
      finish();
    }
  });

  for (const entry of entries) {
    const file = new ZipPassThrough(entry.name);
    zip.add(file);
    const reader = entry.blob.stream().getReader();
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      file.push(value, false);
    }
    file.push(new Uint8Array(0), true);
  }
  zip.end();
  await done;
  return new Blob(blobs, { type: 'application/zip' });
}
