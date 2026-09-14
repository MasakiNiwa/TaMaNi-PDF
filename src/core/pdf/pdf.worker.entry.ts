/**
 * pdf.js のワーカーの入口。
 *
 * 素の pdf.worker をそのまま読み込むのではなく、先に polyfill を通してから読み込む。
 * ワーカーはメインスレッドとグローバルを共有しないため、ここで入れ直す必要がある。
 */
import '../polyfills';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
