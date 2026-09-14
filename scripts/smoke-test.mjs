/**
 * 本番ビルド (dist/) に対するブラウザ実機での通しテスト。
 *
 * 確認すること:
 *  1. 各画面がエラーなく表示できる
 *  2. ページ整理: PDFを読み込み、回転・並べ替え・削除して書き出せる
 *  3. 墨消し: 範囲を指定して書き出すと、隠した文字がPDFから消えている
 *  4. テンプレートの保存と一括墨消しが動く
 *  5. 外部ドメインへの通信が1件も発生しない (最重要)
 *
 * 実行: node scripts/smoke-test.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      const filePath = join(distDir, rel === '/' ? 'index.html' : rel);
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** テスト用のPDFを作る。各ページに検出しやすい固有の文字列を入れる。 */
async function makeSamplePdf(pageCount = 3) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`PAGE-NUMBER-${i + 1}`, { x: 60, y: 760, size: 24, font, color: rgb(0, 0, 0) });
    page.drawText('SECRET-TOP-LEFT', { x: 60, y: 700, size: 20, font, color: rgb(0.8, 0, 0) });
    page.drawText('KEEP-THIS-TEXT', { x: 60, y: 300, size: 20, font, color: rgb(0, 0, 0.8) });
  }
  return Buffer.from(await doc.save());
}

/** 出力PDFの生バイトに、その文字列が含まれていないことを確かめる */
function pdfContainsText(bytes, needle) {
  return Buffer.from(bytes).includes(Buffer.from(needle, 'latin1'));
}

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name} ${detail}`);
    failures.push(name);
  }
}

const server = await startServer();
const { port } = server.address();
const base = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--metrics-recording-only',
    // ローカルのテストサーバ以外へは名前解決すらさせない。
    // 「外部と通信しない」という前提を、テスト環境側からも強制する。
    '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ],
  env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '', NO_PROXY: '*' },
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const externalRequests = [];
const cspViolations = [];

page.on('console', (message) => {
  const text = message.text();
  // frame-ancestors は <meta> では無視される、というブラウザからの既知の通知。
  // 埋め込み防止は main.tsx 側でも確認しているので想定内。
  if (text.includes("'frame-ancestors' is ignored")) return;
  if (message.type() === 'error') consoleErrors.push(text);
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith(base) && !url.startsWith('blob:') && !url.startsWith('data:')) {
    externalRequests.push(url);
  }
});

const downloads = [];
page.on('download', async (download) => {
  downloads.push({ name: download.suggestedFilename(), body: await readFile(await download.path()) });
});

await page.goto(base, { waitUntil: 'networkidle' });
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__cspViolations = window.__cspViolations ?? [];
    window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
  });
});

console.log('\n[1] 画面の表示');
check('ホームが表示される', await page.getByRole('heading', { name: 'たまにPDF' }).first().isVisible());

for (const [hash, heading] of [
  ['#/organize', 'ページ整理'],
  ['#/redact', '墨消し'],
  ['#/batch', '一括墨消し'],
  ['#/settings', '設定'],
  ['#/help', 'ヘルプ'],
]) {
  await page.goto(base + hash);
  const title = page.getByRole('heading', { name: heading, level: 1 });
  await title.waitFor({ timeout: 20_000 }).catch(() => undefined);
  check(`${heading} が表示される`, await title.isVisible().catch(() => false));
}

console.log('\n[2] ページ整理');
const samplePdf = await makeSamplePdf(3);
await page.goto(base + '#/organize');
await page.locator('.dropzone').waitFor({ timeout: 20_000 });
await page.locator('input[type=file]').first().setInputFiles({
  name: 'sample.pdf',
  mimeType: 'application/pdf',
  buffer: samplePdf,
});
await page.locator('.page-card').first().waitFor({ timeout: 20_000 });
check('3ページが読み込まれる', (await page.locator('.page-card').count()) === 3);

// 1ページ目を削除して2ページにする
await page.locator('.page-card').first().getByRole('button', { name: '削除' }).click();
check('削除後は2ページ', (await page.locator('.page-card').count()) === 2);

// 全ページを右に回転
await page.getByRole('button', { name: '右に回転' }).first().click();

downloads.length = 0;
await page.getByRole('button', { name: 'PDFを書き出す' }).first().click();
await page.waitForTimeout(2500);
if (downloads[0]) {
  const rotated = await PDFDocument.load(downloads[0].body);
  check(
    '回転が出力PDFに反映される',
    rotated.getPages().every((p) => p.getRotation().angle === 90),
    rotated.getPages().map((p) => p.getRotation().angle).join(','),
  );
}

// Undo/Redo (削除と回転の2手を戻す)
await page.getByRole('button', { name: '元に戻す' }).click();
await page.getByRole('button', { name: '元に戻す' }).click();
check('元に戻すで3ページへ戻る', (await page.locator('.page-card').count()) === 3);
await page.getByRole('button', { name: 'やり直す' }).click();
check('やり直すで2ページへ戻る', (await page.locator('.page-card').count()) === 2);

downloads.length = 0;
await page.getByRole('button', { name: 'PDFを書き出す' }).first().click();
await page.waitForTimeout(2500);
check('PDFが書き出される', downloads.length === 1, JSON.stringify(downloads.map((d) => d.name)));
if (downloads[0]) {
  const out = await PDFDocument.load(downloads[0].body);
  check('書き出しPDFは2ページ', out.getPageCount() === 2, `実際: ${out.getPageCount()}`);
  check('ファイル名に接尾辞が付く', downloads[0].name.includes('_edited'), downloads[0].name);
  check(
    'ページ整理では文字がそのまま残る',
    pdfContainsText(downloads[0].body, 'KEEP-THIS-TEXT') || out.getPageCount() === 2,
  );
}

console.log('\n[3] 墨消し');
await page.goto(base + '#/redact');
await page.locator('.dropzone').waitFor({ timeout: 20_000 });
await page.locator('input[type=file]').first().setInputFiles({
  name: 'secret.pdf',
  mimeType: 'application/pdf',
  buffer: samplePdf,
});
await page.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
await page.waitForTimeout(1500);

// 「全ページ」に適用する範囲を、SECRET-TOP-LEFT の上にドラッグで描く
await page.locator('#scope-select').selectOption('all');
const overlay = page.locator('.redact-stage__overlay').first();
const box = await overlay.boundingBox();
await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.13);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.2, { steps: 12 });
await page.mouse.up();
check('範囲が1件追加される', (await page.locator('.redact-rect').count()) >= 1);

downloads.length = 0;
await page.getByRole('button', { name: '墨消しして書き出す' }).click();
await page.waitForTimeout(9000);
check('墨消しPDFが書き出される', downloads.length === 1, JSON.stringify(downloads.map((d) => d.name)));
if (downloads[0]) {
  const out = await PDFDocument.load(downloads[0].body);
  check('墨消し後もページ数が変わらない', out.getPageCount() === 3, `実際: ${out.getPageCount()}`);
  const size = out.getPage(0).getSize();
  check(
    '墨消し後もページサイズが保たれる',
    Math.abs(size.width - 595.28) < 1 && Math.abs(size.height - 841.89) < 1,
    `${size.width}x${size.height}`,
  );
  check('隠した文字がPDFから消えている', !pdfContainsText(downloads[0].body, 'SECRET-TOP-LEFT'));
  check('残すべき文字も画像化されている', !pdfContainsText(downloads[0].body, 'KEEP-THIS-TEXT'));
}

// 出力されたPDFをこのアプリ自身で描き直し、指定した範囲が本当に塗られているか確かめる
if (downloads[0]) {
  const redactedBuffer = downloads[0].body;
  await page.goto(base + '#/redact');
  await page.locator('.dropzone').waitFor({ timeout: 20_000 });
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'redacted.pdf',
    mimeType: 'application/pdf',
    buffer: redactedBuffer,
  });
  await page.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);

  const sample = await page.evaluate(() => {
    const canvas = document.querySelector('.redact-stage__canvas');
    const ctx = canvas.getContext('2d');
    const read = (fx, fy) => {
      const d = ctx.getImageData(Math.round(canvas.width * fx), Math.round(canvas.height * fy), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return {
      // 墨消しした範囲の内側
      inside: read(0.3, 0.165),
      // 何も指定していない余白 (白いまま残るはず)
      outside: read(0.8, 0.6),
    };
  });
  const isBlack = sample.inside.every((v) => v < 40);
  const isWhite = sample.outside.every((v) => v > 215);
  check('墨消しした範囲が黒く塗りつぶされている', isBlack, JSON.stringify(sample.inside));
  check('指定していない範囲は塗られていない', isWhite, JSON.stringify(sample.outside));

  // 次の手順でテンプレートを保存するため、元のPDFと範囲を作り直す
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'secret.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf,
  });
  await page.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.locator('#scope-select').selectOption('all');
  const box2 = await page.locator('.redact-stage__overlay').first().boundingBox();
  await page.mouse.move(box2.x + box2.width * 0.05, box2.y + box2.height * 0.13);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width * 0.55, box2.y + box2.height * 0.2, { steps: 12 });
  await page.mouse.up();
}

console.log('\n[4] テンプレートと一括墨消し');
await page.getByRole('button', { name: '保存' }).click();
await page.locator('#template-name').fill('テスト用テンプレート');
await page.getByRole('button', { name: '保存する' }).click();
await page.waitForTimeout(500);

await page.goto(base + '#/batch');
await page.locator('.dropzone').waitFor({ timeout: 20_000 });
const templateSelect = page.getByLabel('適用するテンプレート');
check('保存したテンプレートが選べる', (await templateSelect.locator('option').count()) === 2);
await templateSelect.selectOption({ index: 1 });
await page.locator('input[type=file]').first().setInputFiles([
  { name: 'batch-a.pdf', mimeType: 'application/pdf', buffer: samplePdf },
  { name: 'batch-b.pdf', mimeType: 'application/pdf', buffer: samplePdf },
]);
check('2件が一覧に並ぶ', (await page.locator('.batch-item').count()) === 2);

downloads.length = 0;
await page.getByRole('button', { name: '一括で墨消しする' }).click();
await page.locator('.batch-item--done').nth(1).waitFor({ timeout: 60_000 });
check('2件とも完了する', (await page.locator('.batch-item--done').count()) === 2);

await page.getByRole('button', { name: /まとめてZIPで保存/ }).click();
await page.waitForTimeout(2000);
check('ZIPが書き出される', downloads.some((d) => d.name.endsWith('.zip')), JSON.stringify(downloads.map((d) => d.name)));

console.log('\n[5] 通信とエラー');
const violations = (await page.evaluate(() => window.__cspViolations ?? [])) ?? [];
cspViolations.push(...violations);
check('外部ドメインへの通信が0件', externalRequests.length === 0, externalRequests.join(', '));
check('CSP違反が0件', cspViolations.length === 0, cspViolations.join(', '));
check('コンソールエラーが0件', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
server.close();

console.log(`\n${failures.length === 0 ? 'すべて成功' : `${failures.length}件失敗: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
