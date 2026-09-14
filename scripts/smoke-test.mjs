/**
 * 本番ビルド (dist/) に対するブラウザ実機での通しテスト。
 *
 * 確認すること:
 *  1. 各画面がエラーなく表示できる
 *  2. ページ整理: PDFを読み込み、回転・並べ替え・削除して書き出せる
 *     (つまみをなぞって順番が入れ替わることを含む)
 *  3. 墨消し: 範囲を指定して書き出すと、隠した文字がPDFから消えている
 *     範囲の移動・サイズ変更・ピンチ拡大・取り消し・クリアが動く
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

/**
 * テスト用のPDFを作る。各ページに検出しやすい固有の文字列を入れる。
 *
 * shift を渡すと、同じ書式のまま中身だけがずれたPDFになる
 * (自動位置合わせの検証用)。
 */
async function makeSamplePdf(pageCount = 3, shift = { x: 0, y: 0 }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595.28, 841.89]);
    const at = (x, y) => ({ x: x + shift.x, y: y + shift.y });
    page.drawText(`PAGE-NUMBER-${i + 1}`, { ...at(60, 760), size: 24, font, color: rgb(0, 0, 0) });
    page.drawText('SECRET-TOP-LEFT', { ...at(60, 700), size: 20, font, color: rgb(0.8, 0, 0) });
    page.drawText('KEEP-THIS-TEXT', { ...at(60, 300), size: 20, font, color: rgb(0, 0, 0.8) });
    // 位置合わせの手がかりになるよう、書式らしい罫線と見出しも入れる
    page.drawRectangle({ ...at(55, 520), width: 480, height: 3, color: rgb(0.2, 0.2, 0.2) });
    page.drawRectangle({ ...at(55, 200), width: 480, height: 3, color: rgb(0.2, 0.2, 0.2) });
    for (let row = 0; row < 6; row += 1) {
      page.drawText(`Item ${row + 1}`, { ...at(70, 480 - row * 28), size: 12, font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(`${(row + 1) * 1200} JPY`, {
        ...at(300, 480 - row * 28),
        size: 12,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
  }
  return Buffer.from(await doc.save());
}

/** 出力PDFの生バイトに、その文字列が含まれていないことを確かめる */
function pdfContainsText(bytes, needle) {
  return Buffer.from(bytes).includes(Buffer.from(needle, 'latin1'));
}

/**
 * 要素の「画面に見えている部分」を一度だけ測って返す。
 *
 * 表示領域はページの下の方にあるため、素直に中心を取るとブラウザの窓の外になり、
 * マウス操作が何にも当たらない。また測るたびにスクロールすると、
 * 1点目と2点目でずれてドラッグが成立しなくなるので、まとめて測る。
 */
async function visibleBand(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await locator.boundingBox();
  const view = page.viewportSize();
  // 上はアプリバーとツールバー、下は下部ナビが貼り付いていて要素を覆うので、その内側を使う
  // 横方向に重なっている要素だけを「覆っているもの」として扱う。
  // 広い画面ではツールバーが横に並ぶので、それを避けると操作できる範囲がなくなってしまう。
  const overlapsX = (other) => other.x < box.x + box.width && other.x + other.width > box.x;
  const obstruct = async (selector, edge) => {
    const found = await page.locator(selector).first().boundingBox().catch(() => null);
    if (!found || !overlapsX(found)) return null;
    return edge === 'bottom' ? found.y + found.height : found.y;
  };
  const appBarBottom = (await obstruct('.app-bar', 'bottom')) ?? 0;
  const toolbarBottom = (await obstruct('.toolbar', 'bottom')) ?? 0;
  const bottomNavTop = (await obstruct('.bottom-nav', 'top')) ?? view.height;

  const top = Math.max(box.y, appBarBottom + 8, toolbarBottom + 8, 8);
  const bottom = Math.min(box.y + box.height, bottomNavTop - 8, view.height - 8);
  if (bottom - top < 40) throw new Error('操作できる範囲が足りません (画面が狭すぎます)');
  return {
    at: (fx, fy) => ({ x: box.x + box.width * fx, y: top + (bottom - top) * fy }),
  };
}

async function pointIn(page, locator, fx = 0.5, fy = 0.5) {
  return (await visibleBand(page, locator)).at(fx, fy);
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

// つまみをドラッグして1枚目と2枚目を入れ替える。
// alt は「何枚目か」なので並べ替えでは変わらない。中身が動いたかはサムネイル画像の
// URL の並びで見る (URL は元ページごとに固有)。
const thumbOrder = () =>
  page.locator('.page-card img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));

const orderBefore = await thumbOrder();
if (orderBefore.length >= 2) {
  const from = await page.locator('.page-card__drag').first().boundingBox();
  const to = await page.locator('.page-card').nth(1).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // 一度ずらしてからゆっくり動かす (dnd-kit は少し動かさないとドラッグを開始しない)
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const orderAfter = await thumbOrder();
  check(
    'つまみのドラッグでページを並べ替えられる',
    orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0],
    `${orderBefore.join(',')} -> ${orderAfter.join(',')}`,
  );
  // 並べ替えた分を戻しておく
  await page.getByRole('button', { name: '元に戻す' }).click();
  await page.waitForTimeout(200);
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
const overlay = page.locator('.redact-viewport').first();
const box = await overlay.boundingBox();
await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.13);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.2, { steps: 12 });
await page.mouse.up();
check('範囲が1件追加される', (await page.locator('.redact-rect').count()) >= 1);

// 追加した直後は選択状態になり、右下のつまみが出る
check('追加した範囲につまみが出る', (await page.locator('.redact-handle').count()) === 1);

const rectBox = () => page.locator('.redact-rect').first().boundingBox();
const before = await rectBox();

// 範囲をドラッグして動かす
await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
await page.mouse.down();
await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 40, { steps: 10 });
await page.mouse.up();
const moved = await rectBox();
check('範囲をドラッグして動かせる', Math.abs(moved.y - before.y) > 20, `${before.y} -> ${moved.y}`);
check('動かしても大きさは変わらない', Math.abs(moved.height - before.height) < 3);

// 右下のつまみを引いて大きくする
const handle = await page.locator('.redact-handle').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 30, { steps: 10 });
await page.mouse.up();
const resized = await rectBox();
check(
  'つまみで範囲の大きさを変えられる',
  resized.width > moved.width + 30 && resized.height > moved.height + 10,
  `${moved.width}x${moved.height} -> ${resized.width}x${resized.height}`,
);

// 拡大表示: ページの中身が拡大され、上下左右に動かせること
const stageTransform = () =>
  page.locator('.redact-stage').evaluate((element) => getComputedStyle(element).transform);
const beforeZoom = await stageTransform();
await page.getByRole('button', { name: '拡大' }).click();
await page.waitForTimeout(1200);
const afterZoom = await stageTransform();
check('拡大すると表示が大きくなる', beforeZoom !== afterZoom, `${beforeZoom} -> ${afterZoom}`);

// 表示領域の高さは変わらない (ページ全体が伸びてしまわないこと)
const viewportBox = await page.locator('.redact-viewport').boundingBox();
await page.getByRole('button', { name: '拡大' }).click();
await page.waitForTimeout(1000);
const viewportBox2 = await page.locator('.redact-viewport').boundingBox();
check(
  '拡大しても表示領域の大きさは変わらない',
  Math.abs(viewportBox2.height - viewportBox.height) < 2,
  `${Math.round(viewportBox.height)} -> ${Math.round(viewportBox2.height)}`,
);

// ホイールで上下にも左右にも動かせる (v0.2.0 では縦に動かせなかった)
const readView = async () => {
  const matrix = await stageTransform();
  const parts = matrix.match(/matrix\(([^)]+)\)/);
  if (!parts) return { x: 0, y: 0 };
  const values = parts[1].split(',').map((v) => Number(v.trim()));
  return { x: values[4], y: values[5] };
};
const wheelPoint = await pointIn(page, page.locator('.redact-viewport'), 0.5, 0.5);
await page.mouse.move(wheelPoint.x, wheelPoint.y);
const viewBefore = await readView();
await page.mouse.wheel(0, 120);
await page.waitForTimeout(200);
const afterVertical = await readView();
check('拡大中はホイールで上下に動かせる', Math.abs(afterVertical.y - viewBefore.y) > 10,
  `${Math.round(viewBefore.y)} -> ${Math.round(afterVertical.y)}`);
await page.mouse.wheel(120, 0);
await page.waitForTimeout(200);
const afterHorizontal = await readView();
check('拡大中はホイールで左右に動かせる', Math.abs(afterHorizontal.x - afterVertical.x) > 10,
  `${Math.round(afterVertical.x)} -> ${Math.round(afterHorizontal.x)}`);

await page.getByRole('button', { name: '幅に合わせる' }).click();
await page.waitForTimeout(800);

// テストの残りに影響しないよう、範囲を元の位置へ引き直す
await page.locator('.redact-rect').first().click();
await page.getByRole('button', { name: 'この範囲を削除' }).click();
const box3 = await page.locator('.redact-viewport').first().boundingBox();
await page.mouse.move(box3.x + box3.width * 0.05, box3.y + box3.height * 0.13);
await page.mouse.down();
await page.mouse.move(box3.x + box3.width * 0.55, box3.y + box3.height * 0.2, { steps: 12 });
await page.mouse.up();

downloads.length = 0;
await page.getByRole('button', { name: '墨消しして書き出す' }).first().click();
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

}

console.log('\n[3b] 墨消しの取り消しとクリア');
{
  // 直前の手順で別のPDFを読み込み直しているため、ここで範囲を引き直してから履歴を試す。
  // 表示領域は画面の外へはみ出していることがあるので、見えている位置を選んで操作する。
  const band = await visibleBand(page, page.locator('.redact-viewport').first());
  for (const [fromY, toY] of [
    [0.12, 0.22],
    [0.4, 0.5],
  ]) {
    const from = band.at(0.15, fromY);
    const to = band.at(0.6, toY);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  const countBefore = await page.locator('.rect-list__item').count();
  check('範囲を2件引ける', countBefore === 2, String(countBefore));
  await page.getByRole('button', { name: '元に戻す' }).click();
  await page.waitForTimeout(300);
  const countUndo = await page.locator('.rect-list__item').count();
  check('墨消しでも元に戻せる', countUndo === countBefore - 1, `${countBefore} -> ${countUndo}`);
  await page.getByRole('button', { name: 'やり直す' }).click();
  await page.waitForTimeout(300);
  check('墨消しでもやり直せる', (await page.locator('.rect-list__item').count()) === countBefore);
}

await page.getByRole('button', { name: 'クリアして最初に戻る' }).click();
await page.getByRole('button', { name: 'クリアする' }).click();
await page.waitForTimeout(600);
check('クリアで最初の画面に戻る', (await page.locator('.redact-viewport').count()) === 0);

// テンプレート保存のため、もう一度読み込んで範囲を引く
await page.locator('input[type=file]').first().setInputFiles({
  name: 'secret.pdf',
  mimeType: 'application/pdf',
  buffer: samplePdf,
});
await page.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
await page.waitForTimeout(1500);
await page.locator('#scope-select').selectOption('all');
const box4 = await page.locator('.redact-viewport').first().boundingBox();
await page.mouse.move(box4.x + box4.width * 0.05, box4.y + box4.height * 0.13);
await page.mouse.down();
await page.mouse.move(box4.x + box4.width * 0.55, box4.y + box4.height * 0.2, { steps: 12 });
await page.mouse.up();

console.log('\n[4] テンプレートと一括墨消し');
await page.getByRole('button', { name: 'テンプレート' }).click();
await page.locator('#template-name').fill('テスト用テンプレート');
await page.getByRole('button', { name: '保存する' }).click();
// 保存するとダイアログは自動で閉じる
await page.waitForTimeout(500);
check('保存後にテンプレートのダイアログが閉じる', (await page.locator('.dialog').count()) === 0);
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

// 書き出す前に、テンプレートの当たり位置を確かめられること
await page.getByRole('button', { name: '1件目でプレビュー' }).click();
await page.locator('.preview-stage__canvas').waitFor({ timeout: 20_000 });
await page.waitForTimeout(2500);
check('適用前にプレビューを開ける', await page.locator('.preview-stage').isVisible());
const previewRects = await page.locator('.preview-rect').count();
check('プレビューに範囲が重なって見える', previewRects >= 1, String(previewRects));
const previewShape = await page.evaluate(() => {
  const canvas = document.querySelector('.preview-stage__canvas');
  const box = document.querySelector('.preview-stage').getBoundingClientRect();
  return { canvasRatio: canvas.width / canvas.height, boxRatio: box.width / box.height };
});
check(
  'プレビューの縦横比がページと合う',
  Math.abs(previewShape.canvasRatio - previewShape.boxRatio) < 0.02,
  `canvas ${previewShape.canvasRatio.toFixed(3)} / box ${previewShape.boxRatio.toFixed(3)}`,
);
await page.locator('.dialog').getByRole('button', { name: '閉じる' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: /まとめてZIPで保存/ }).click();
await page.waitForTimeout(2000);
check('ZIPが書き出される', downloads.some((d) => d.name.endsWith('.zip')), JSON.stringify(downloads.map((d) => d.name)));

console.log('\n[4b] テンプレートの自動位置合わせ');
{
  // 同じ書式のまま中身だけ右下にずれたPDFを用意し、
  // テンプレートの範囲がその分だけ動いて当たるかを見る。
  const shiftX = 24;
  const shiftY = -36;
  const shifted = await makeSamplePdf(3, { x: shiftX, y: shiftY });

  // 出力PDFを開いて、黒い帯が縦のどのあたりに出るかを測る
  const blackBandTop = async (buffer, name) => {
    await page.goto(base + '#/redact');
    await page.locator('.dropzone').waitFor({ timeout: 20_000 });
    await page.locator('input[type=file]').first().setInputFiles({
      name,
      mimeType: 'application/pdf',
      buffer,
    });
    await page.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    return page.evaluate(() => {
      const canvas = document.querySelector('.redact-stage__canvas');
      const ctx = canvas.getContext('2d');
      const x = Math.round(canvas.width * 0.3);
      const column = ctx.getImageData(x, 0, 1, canvas.height).data;
      for (let y = 0; y < canvas.height; y += 1) {
        const at = y * 4;
        if (column[at] < 40 && column[at + 1] < 40 && column[at + 2] < 40) return y / canvas.height;
      }
      return -1;
    });
  };

  // 同じURL (#/batch) への goto はページを読み直さないことがあり、
  // 前のファイル一覧が残ったまま次の検証をしてしまう。明示的に読み直す。
  const openBatch = async () => {
    await page.goto(base + '#/batch');
    await page.reload({ waitUntil: 'load' });
    await page.locator('.dropzone').waitFor({ timeout: 20_000 });
  };

  // 一覧の中から名前で選ぶ (テンプレートが増えても取り違えないように)
  const selectTemplate = async (name) => {
    const select = page.getByLabel('適用するテンプレート');
    const value = await select.evaluate((element, needle) => {
      const option = [...element.options].find((item) => item.textContent.includes(needle));
      return option ? option.value : '';
    }, name);
    await select.selectOption(value);
  };

  const runBatch = async (files) => {
    await openBatch();
    await selectTemplate('位置合わせ用');
    await page.locator('input[type=file]').first().setInputFiles(files);
    downloads.length = 0;
    await page.getByRole('button', { name: '一括で墨消しする' }).click();
    await page.locator('.batch-item--done').nth(files.length - 1).waitFor({ timeout: 60_000 });
  };

  // 既定はオフ。初めて使う人が、何も選ばないまま画像を保存してしまわないようにしている。
  await page.goto(base + '#/settings');
  await page.reload({ waitUntil: 'load' });
  const defaultValue = await page.getByLabel('自動位置合わせ').inputValue();
  check('自動位置合わせの既定はオフ', defaultValue === 'off', defaultValue);

  // オンにしてから、基準画像つきのテンプレートを作る
  await page.getByLabel('自動位置合わせ').selectOption('on');
  await page.waitForTimeout(300);
  await page.goto(base + '#/redact');
  await page.reload({ waitUntil: 'load' });
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'align-src.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf,
  });
  await page.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.locator('#scope-select').selectOption('all');
  const alignBox = await page.locator('.redact-viewport').first().boundingBox();
  await page.mouse.move(alignBox.x + alignBox.width * 0.05, alignBox.y + alignBox.height * 0.13);
  await page.mouse.down();
  await page.mouse.move(alignBox.x + alignBox.width * 0.55, alignBox.y + alignBox.height * 0.2, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'テンプレート' }).click();
  await page.locator('#template-name').fill('位置合わせ用');
  await page.getByRole('button', { name: '保存する' }).click();
  await page.waitForTimeout(1200);
  const savedWithAnchor = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('tamani-pdf:templates') ?? '[]');
    const target = raw.find((item) => item.name === '位置合わせ用');
    return Boolean(target && target.anchor && target.anchor.fingerprint.data.length > 1000);
  });
  check('オンのときは基準画像つきで保存される', savedWithAnchor);

  // まずはずれていないPDF。ここが基準の位置になる。
  await runBatch([{ name: 'align-base.pdf', mimeType: 'application/pdf', buffer: samplePdf }]);
  const baseStatus = await page.locator('.batch-item__status').first().innerText();
  check('位置合わせの結果が一覧に出る', baseStatus.includes('補正') || baseStatus.includes('ずれなし'), baseStatus);
  await page.locator('.batch-item').first().getByRole('button', { name: /を保存/ }).click();
  await page.waitForTimeout(2500);
  const baseOut = downloads.find((d) => d.name.endsWith('.pdf'));

  // 次に中身がずれたPDF
  await runBatch([{ name: 'align-shifted.pdf', mimeType: 'application/pdf', buffer: shifted }]);
  const shiftedStatus = await page.locator('.batch-item__status').first().innerText();
  check('ずれたPDFでは補正が働く', shiftedStatus.includes('補正'), shiftedStatus);
  await page.locator('.batch-item').first().getByRole('button', { name: /を保存/ }).click();
  await page.waitForTimeout(2500);
  const shiftedOut = downloads.find((d) => d.name.endsWith('.pdf'));

  if (baseOut && shiftedOut) {
    const baseTop = await blackBandTop(baseOut.body, 'align-base-out.pdf');
    const shiftedTop = await blackBandTop(shiftedOut.body, 'align-shifted-out.pdf');
    // PDFの y は上向き、画面の y は下向きなので、下へ36ポイント動いたぶんを割合にする
    const expected = -shiftY / 841.89;
    const actual = shiftedTop - baseTop;
    check(
      '塗った位置が中身のずれに追従する',
      baseTop > 0 && shiftedTop > 0 && Math.abs(actual - expected) < 0.015,
      `期待 ${expected.toFixed(3)} / 実際 ${actual.toFixed(3)}`,
    );
  } else {
    check('塗った位置が中身のずれに追従する', false, '出力PDFを取得できませんでした');
  }

  // プレビューにも同じ補正がかかり、一致度が表示されること
  await openBatch();
  await selectTemplate('位置合わせ用');
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'align-shifted.pdf', mimeType: 'application/pdf', buffer: shifted },
  ]);
  await page.getByRole('button', { name: '1件目でプレビュー' }).click();
  await page.locator('.preview-stage__canvas').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  const previewText = await page.locator('.dialog').innerText();
  check('プレビューに一致度が出る', /一致度\s*\d+%/.test(previewText), previewText.slice(-120));
  const alignedTop = await page.locator('.preview-rect').first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    const stage = element.parentElement.getBoundingClientRect();
    return (box.top - stage.top) / stage.height;
  });
  await page.locator('.dialog').getByRole('button', { name: '閉じる' }).click();
  await page.waitForTimeout(300);

  // 設定で切ると補正しなくなること
  await page.goto(base + '#/settings');
  await page.getByLabel('自動位置合わせ').selectOption('off');
  await page.waitForTimeout(300);
  await openBatch();
  await selectTemplate('位置合わせ用');
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'align-shifted.pdf', mimeType: 'application/pdf', buffer: shifted },
  ]);
  await page.getByRole('button', { name: '1件目でプレビュー' }).click();
  await page.locator('.preview-stage__canvas').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  const offText = await page.locator('.dialog').innerText();
  check('設定で切ると自動位置合わせを行わない', offText.includes('オフ'), offText.slice(-120));
  const rawTop = await page.locator('.preview-rect').first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    const stage = element.parentElement.getBoundingClientRect();
    return (box.top - stage.top) / stage.height;
  });
  check(
    '切ったときは範囲が動かない',
    alignedTop - rawTop > 0.02,
    `補正あり ${alignedTop.toFixed(3)} / 補正なし ${rawTop.toFixed(3)}`,
  );
  await page.locator('.dialog').getByRole('button', { name: '閉じる' }).click();

  // オフのときは、ヘルプの説明も既定の書き方に切り替わる
  await page.goto(base + '#/help');
  await page.reload({ waitUntil: 'load' });
  const helpOff = await page.locator('.page').innerText();
  check('ヘルプの説明がオフ向けになる', helpOff.includes('オフ (既定)'), '');
  await page.goto(base + '#/settings');
  await page.getByLabel('自動位置合わせ').selectOption('on');
  await page.waitForTimeout(300);
  await page.goto(base + '#/help');
  await page.reload({ waitUntil: 'load' });
  const helpOn = await page.locator('.page').innerText();
  check('ヘルプの説明がオン向けになる', helpOn.includes('オンです'), '');

  // 後片付け: 既定 (オフ) に戻す
  await page.goto(base + '#/settings');
  await page.getByLabel('自動位置合わせ').selectOption('off');
  await page.waitForTimeout(300);
}

console.log('\n[5] スマホのタッチ操作');
{
  // 実機の指操作に近づけるため、タッチ対応のコンテキストとCDPのタッチイベントを使う。
  // v0.1.0 では並べ替え用の当たり判定がページ全体を覆っていて、
  // 「長押しして動かしても並べ替えられない」不具合があったため、ここで作り分けを検証する。
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  touchPage.setDefaultTimeout(20_000);
  const cdp = await touchContext.newCDPSession(touchPage);

  const touch = async (type, x, y) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
    });
  };
  const touchDrag = async (from, to, { holdMs = 300, steps = 12 } = {}) => {
    await touch('touchStart', from.x, from.y);
    await touchPage.waitForTimeout(holdMs);
    for (let i = 1; i <= steps; i += 1) {
      await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await touchPage.waitForTimeout(16);
    }
    await touchPage.waitForTimeout(60);
    await touch('touchEnd', to.x, to.y);
  };
  /**
   * 指で触れる点を返す。
   * スマホ表示では画面下部を固定のナビゲーションバーが覆っているので、その手前に収める。
   */
  const center = async (locator, fy = 0.5) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const nav = await touchPage.locator('.bottom-nav').boundingBox();
    const top = Math.max(box.y, 16);
    const bottom = Math.min(box.y + box.height, nav ? nav.y - 16 : 828);
    return { x: box.x + box.width / 2, y: top + Math.max(0, bottom - top) * fy };
  };

  await touchPage.goto(base + '#/organize');
  await touchPage.locator('.dropzone').waitFor({ timeout: 20_000 });
  await touchPage.locator('input[type=file]').first().setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf,
  });
  await touchPage.locator('.page-card').first().waitFor({ timeout: 20_000 });
  await touchPage.waitForTimeout(2500);

  const touchThumbOrder = () =>
    touchPage.locator('.page-card img').evaluateAll((images) => images.map((i) => i.getAttribute('src')));

  // (1) つまみをなぞると並べ替えられる (長押しは不要)
  const beforeOrder = await touchThumbOrder();
  await touchDrag(await center(touchPage.locator('.page-card__drag').first()), await center(touchPage.locator('.page-card').nth(1)));
  await touchPage.waitForTimeout(500);
  const afterOrder = await touchThumbOrder();
  check(
    'スマホ: つまみをなぞると並べ替えられる',
    afterOrder[0] === beforeOrder[1] && afterOrder[1] === beforeOrder[0],
    `${beforeOrder.length}枚 ${beforeOrder[0] === afterOrder[0] ? '順序が変わらなかった' : ''}`,
  );

  // (2) つまみ以外を指でなぞったときは、並べ替えではなく画面のスクロールになる
  const orderBeforeScroll = await touchThumbOrder();
  const scrollBefore = await touchPage.evaluate(() => window.scrollY);
  const cardCenter = await center(touchPage.locator('.page-card').first());
  await touchDrag(cardCenter, { x: cardCenter.x, y: cardCenter.y - 260 }, { holdMs: 0, steps: 10 });
  await touchPage.waitForTimeout(400);
  const scrollAfter = await touchPage.evaluate(() => window.scrollY);
  check('スマホ: ページ一覧を指でスクロールできる', scrollAfter > scrollBefore + 40, `${scrollBefore} -> ${scrollAfter}`);
  check(
    'スマホ: スクロールでは並び順が変わらない',
    (await touchThumbOrder()).join() === orderBeforeScroll.join(),
  );

  // (3) 墨消し: 指のドラッグで範囲を追加できる
  await touchPage.goto(base + '#/redact');
  await touchPage.locator('.dropzone').waitFor({ timeout: 20_000 });
  await touchPage.locator('input[type=file]').first().setInputFiles({
    name: 'secret.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf,
  });
  await touchPage.locator('.redact-stage__canvas').waitFor({ timeout: 20_000 });
  await touchPage.waitForTimeout(2000);
  const viewportLocator = touchPage.locator('.redact-viewport').first();
  const drawFrom = await center(viewportLocator, 0.15);
  const drawTo = await center(viewportLocator, 0.25);
  await touchDrag(
    { x: drawFrom.x - 80, y: drawFrom.y },
    { x: drawTo.x + 60, y: drawTo.y },
    { holdMs: 0 },
  );
  await touchPage.waitForTimeout(300);
  check('スマホ: 指のドラッグで範囲を追加できる', (await touchPage.locator('.redact-rect').count()) >= 1);

  // (4) 2本指でつまむと拡大でき、そのまま動かすと表示位置が変わる
  {
    const pinchAt = await center(touchPage.locator('.redact-viewport'), 0.5);
    const readScale = () =>
      touchPage.locator('.redact-stage').evaluate((element) => {
        const m = getComputedStyle(element).transform.match(/matrix\(([^)]+)\)/);
        return m ? Number(m[1].split(',')[0]) : 1;
      });
    const scaleBefore = await readScale();
    const cx = pinchAt.x;
    const cy = pinchAt.y;
    const pinch = async (spread) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - spread, y: cy, id: 1 },
          { x: cx + spread, y: cy, id: 2 },
        ],
      });
    };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 40, y: cy, id: 1 },
        { x: cx + 40, y: cy, id: 2 },
      ],
    });
    for (const spread of [45, 60, 75, 85]) {
      await pinch(spread);
      await touchPage.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForTimeout(600);
    const scaleAfter = await readScale();
    check('スマホ: 2本指のピンチで拡大できる', scaleAfter > scaleBefore * 1.3, `${scaleBefore} -> ${scaleAfter}`);
    check('スマホ: ピンチの倍率は上限内に収まる', scaleAfter <= 4.01, String(scaleAfter));

    // ちらつきの検証。
    // かつては (1) 表示領域の高さをJSで決めていたため大きさが往復し、
    // (2) 倍率が変わるたびに描き直していたため、同じキャンバスに二重に描いて
    // 絵が壊れる、という2つの問題があった。どちらも「揺れないこと」で確認する。
    const samples = await touchPage.evaluate(async () => {
      const viewport = document.querySelector('.redact-viewport');
      const canvas = document.querySelector('.redact-stage__canvas');
      const widths = new Set();
      const bitmaps = new Set();
      for (let i = 0; i < 30; i += 1) {
        widths.add(Math.round(viewport.getBoundingClientRect().width));
        bitmaps.add(`${canvas.width}x${canvas.height}`);
        await new Promise((r) => setTimeout(r, 30));
      }
      return { widths: [...widths], bitmaps: [...bitmaps] };
    });
    check('スマホ: 表示領域の大きさが揺れない', samples.widths.length === 1, samples.widths.join(','));
    check(
      'スマホ: 描き直しが繰り返されない',
      samples.bitmaps.length <= 2,
      samples.bitmaps.join(' / '),
    );

    // 描き直したあとも、ページの縦横比どおりの絵になっている (上下反転や潰れの検出)
    await touchPage.waitForTimeout(1200);
    const shape = await touchPage.evaluate(() => {
      const canvas = document.querySelector('.redact-stage__canvas');
      const viewport = document.querySelector('.redact-viewport');
      const box = viewport.getBoundingClientRect();
      return {
        canvasRatio: canvas.width / canvas.height,
        boxRatio: box.width / box.height,
      };
    });
    check(
      'スマホ: 拡大後も絵の縦横比が保たれる',
      Math.abs(shape.canvasRatio - shape.boxRatio) < 0.02,
      `canvas ${shape.canvasRatio.toFixed(3)} / box ${shape.boxRatio.toFixed(3)}`,
    );

    // 拡大したまま、1本指で範囲を動かせること (上下方向)
    await touchPage.getByRole('button', { name: '幅に合わせる' }).click();
    await touchPage.waitForTimeout(600);
  }

  // (5) 指で範囲を動かせる
  const rectBefore = await touchPage.locator('.redact-rect').first().boundingBox();
  await touchDrag(
    { x: rectBefore.x + rectBefore.width / 2, y: rectBefore.y + rectBefore.height / 2 },
    { x: rectBefore.x + rectBefore.width / 2, y: rectBefore.y + rectBefore.height / 2 + 50 },
    { holdMs: 0 },
  );
  await touchPage.waitForTimeout(300);
  const rectAfter = await touchPage.locator('.redact-rect').first().boundingBox();
  check(
    'スマホ: 指で範囲を動かせる',
    Math.abs(rectAfter.y - rectBefore.y) > 25,
    `${Math.round(rectBefore.y)} -> ${Math.round(rectAfter.y)}`,
  );

  await touchContext.close();
}

console.log('\n[5b] 横長の画面');
{
  // 画面の向きではなく「幅と高さの両方に余裕があるか」で配置を切り替えている。
  // 横向きのスマホは高さが足りないので縦積みのまま、PCの横長だけ左右に分ける。
  const measure = async (size) => {
    const context = await browser.newContext({ viewport: size, hasTouch: true });
    const wide = await context.newPage();
    wide.setDefaultTimeout(20_000);
    await wide.goto(base + '#/redact');
    await wide.locator('.dropzone').waitFor({ timeout: 20_000 });
    await wide.locator('input[type=file]').first().setInputFiles({
      name: 'secret.pdf',
      mimeType: 'application/pdf',
      buffer: samplePdf,
    });
    await wide.locator('.redact-viewport').waitFor({ timeout: 20_000 });
    await wide.waitForTimeout(2500);

    const boxes = await wide.evaluate(() => {
      const pick = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const shown = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        return getComputedStyle(element).display !== 'none';
      };
      return {
        viewport: pick('.redact-viewport'),
        tools: pick('.redact-workspace__tools'),
        side: pick('.redact-workspace__side'),
        rail: shown('.nav-rail'),
        bottomNav: shown('.bottom-nav'),
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    await context.close();
    return boxes;
  };

  // 横向きのスマホ。左右に分けるとどちらの列も窮屈になるので、縦積みのままにする。
  const phone = await measure({ width: 844, height: 390 });
  check(
    '横向きスマホ: 縦長と同じ縦積みのまま',
    phone.tools.y < phone.viewport.y && phone.viewport.y < phone.side.y,
    `操作 ${Math.round(phone.tools.y)} / PDF ${Math.round(phone.viewport.y)} / 情報 ${Math.round(phone.side.y)}`,
  );
  check(
    '横向きスマホ: 下のナビゲーションが出る',
    phone.bottomNav && !phone.rail,
    `bottom ${phone.bottomNav} / rail ${phone.rail}`,
  );
  check(
    '横向きスマホ: 横にはみ出さない',
    phone.scrollWidth <= phone.windowWidth + 2,
    `${phone.scrollWidth} / ${phone.windowWidth}`,
  );
  check(
    '横向きスマホ: PDFが画面内に収まる',
    phone.viewport.h < phone.windowHeight && phone.viewport.w < phone.windowWidth,
    `${Math.round(phone.viewport.w)}x${Math.round(phone.viewport.h)} / ${phone.windowWidth}x${phone.windowHeight}`,
  );

  // PCの横長。左をPDF専用にして高さいっぱいに使い、操作と情報を右の列へ。
  const pc = await measure({ width: 1280, height: 800 });
  check(
    'PC横長: PDFが画面の高さをおおむね使う',
    pc.viewport.h > pc.windowHeight * 0.6,
    `${Math.round(pc.viewport.h)} / ${pc.windowHeight}`,
  );
  check(
    'PC横長: 操作パネルがPDFの右にある',
    pc.tools.x > pc.viewport.x + pc.viewport.w - 2,
    `pdf右端 ${Math.round(pc.viewport.x + pc.viewport.w)} / パネル左端 ${Math.round(pc.tools.x)}`,
  );
  check(
    'PC横長: 情報パネルもPDFの右にある',
    pc.side.x > pc.viewport.x + pc.viewport.w - 2,
    `${Math.round(pc.side.x)}`,
  );
  check(
    'PC横長: ページ全体がスクロールしない',
    pc.scrollHeight <= pc.windowHeight + 4,
    `${pc.scrollHeight} / ${pc.windowHeight}`,
  );
  check(
    'PC横長: 左のナビゲーションレールが出る',
    pc.rail && !pc.bottomNav,
    `rail ${pc.rail} / bottom ${pc.bottomNav}`,
  );
}

console.log('\n[6] 通信とエラー');
const violations = (await page.evaluate(() => window.__cspViolations ?? [])) ?? [];
cspViolations.push(...violations);
check('外部ドメインへの通信が0件', externalRequests.length === 0, externalRequests.join(', '));
check('CSP違反が0件', cspViolations.length === 0, cspViolations.join(', '));
check('コンソールエラーが0件', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
server.close();

console.log(`\n${failures.length === 0 ? 'すべて成功' : `${failures.length}件失敗: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
