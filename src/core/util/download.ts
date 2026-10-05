import { sanitizeFileName } from './format';

function toBlob(bytes: Uint8Array, mime: string): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: mime });
}

/**
 * バイト列をローカルに保存する。
 * Blob URL はこのブラウザの中だけで完結し、ネットワークには出ない。
 */
export function saveBytes(bytes: Uint8Array, fileName: string, mime = 'application/pdf'): void {
  saveBlob(toBlob(bytes, mime), fileName);
}

/**
 * Blob をそのまま保存する。
 * 大きなPDFでも、中身を1つのバイト列に読み戻さずに渡せる。
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sanitizeFileName(fileName);
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari が読み終わる前に revoke しないよう少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function saveText(text: string, fileName: string, mime = 'application/json'): void {
  saveBytes(new TextEncoder().encode(text), fileName, mime);
}
