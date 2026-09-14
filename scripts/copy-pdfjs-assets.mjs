/**
 * pdf.js が必要とする補助アセット (CMap / 標準フォント / wasm / ICC) を
 * node_modules から public/pdfjs へコピーする。
 *
 * これらを CDN から取得しないことで、アプリの通信先を「自分自身のオリジンだけ」に
 * 限定できる。CSP の connect-src を 'self' に閉じるための前提となる処理。
 */
import { cp, rm, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/pdfjs-dist');
const to = resolve(root, 'public/pdfjs');

const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const dir of DIRS) {
  await cp(resolve(from, dir), resolve(to, dir), { recursive: true });
}
await cp(resolve(from, 'LICENSE'), resolve(to, 'LICENSE_PDFJS'));
console.log(`[copy-pdfjs-assets] copied ${DIRS.join(', ')} -> public/pdfjs`);
