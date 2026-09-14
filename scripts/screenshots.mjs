/**
 * 各画面のスクリーンショットを撮る (見た目の確認用)。
 * 出力先は引数、既定は ./screenshots。
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const outDir = resolve(process.argv[2] ?? join(root, 'screenshots'));
await mkdir(outDir, { recursive: true });

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
};
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      const filePath = join(distDir, rel === '/' ? 'index.html' : rel);
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('nf');
    }
  });
  s.listen(0, '127.0.0.1', () => ok(s));
});
const base = `http://127.0.0.1:${server.address().port}/`;

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.HelveticaBold);
const body = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 4; i += 1) {
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('INVOICE', { x: 60, y: 770, size: 28, font, color: rgb(0.1, 0.1, 0.2) });
  p.drawText(`No. 2026-00${i + 1}`, { x: 60, y: 735, size: 14, font: body, color: rgb(0.3, 0.3, 0.35) });
  p.drawText('Customer: Yamada Taro', { x: 60, y: 690, size: 14, font: body, color: rgb(0, 0, 0) });
  p.drawText('Address: Tokyo, Japan', { x: 60, y: 668, size: 14, font: body, color: rgb(0, 0, 0) });
  for (let row = 0; row < 6; row += 1) {
    p.drawText(`Item ${row + 1}`, { x: 60, y: 580 - row * 26, size: 12, font: body, color: rgb(0.2, 0.2, 0.2) });
    p.drawText(`${(row + 1) * 1200} JPY`, {
      x: 420,
      y: 580 - row * 26,
      size: 12,
      font: body,
      color: rgb(0.2, 0.2, 0.2),
    });
  }
  p.drawText(`- ${i + 1} -`, { x: 285, y: 50, size: 11, font: body, color: rgb(0.5, 0.5, 0.5) });
}
const samplePdf = Buffer.from(await doc.save());

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ],
  env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '', NO_PROXY: '*' },
});

async function shoot(name, { width, height, dark, route, setup }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: dark ? 'dark' : 'light',
    isMobile: width < 600,
    hasTouch: width < 600,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(base + route, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  if (setup) await setup(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  await context.close();
  console.log('saved', `${name}.png`);
}

const loadIntoOrganize = async (page) => {
  await page.locator('.dropzone').waitFor();
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf,
  });
  await page.locator('.page-card').first().waitFor();
  await page.waitForTimeout(2500);
};

const loadIntoRedact = async (page) => {
  await page.locator('.dropzone').waitFor();
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf,
  });
  await page.locator('.redact-stage__canvas').waitFor();
  await page.waitForTimeout(2000);
  const box = await page.locator('.redact-stage__overlay').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.175);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.225, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.203);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.248, { steps: 10 });
  await page.mouse.up();
};

await shoot('desktop-home', { width: 1280, height: 900, route: '' });
await shoot('desktop-organize', { width: 1280, height: 1000, route: '#/organize', setup: loadIntoOrganize });
await shoot('desktop-redact', { width: 1280, height: 1000, route: '#/redact', setup: loadIntoRedact });
await shoot('desktop-batch', { width: 1280, height: 900, route: '#/batch' });
await shoot('desktop-settings', { width: 1280, height: 1100, route: '#/settings' });
await shoot('desktop-help', { width: 1280, height: 1000, route: '#/help' });
await shoot('desktop-home-dark', { width: 1280, height: 900, route: '', dark: true });
await shoot('desktop-organize-dark', {
  width: 1280,
  height: 1000,
  route: '#/organize',
  dark: true,
  setup: loadIntoOrganize,
});
await shoot('mobile-home', { width: 390, height: 844, route: '' });
await shoot('mobile-organize', { width: 390, height: 844, route: '#/organize', setup: loadIntoOrganize });
await shoot('mobile-redact', { width: 390, height: 844, route: '#/redact', setup: loadIntoRedact });
await shoot('mobile-settings-dark', { width: 390, height: 844, route: '#/settings', dark: true });

await browser.close();
server.close();
