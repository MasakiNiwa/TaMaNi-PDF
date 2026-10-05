/**
 * ブラウザを使わずに確かめられる、計算だけの部品のテスト。
 *
 * TypeScript のまま書いた部品を、その場で JavaScript に直して読み込む
 * (テストのためだけにビルドの手順を増やさないため)。
 *
 * 実行: node scripts/unit-test.mjs
 */
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(join(tmpdir(), 'tamani-unit-'));

/** 依存のない TypeScript の部品を読み込む */
async function load(path) {
  const source = await readFile(join(root, path), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const file = join(work, path.replaceAll('/', '_').replace(/\.ts$/, '.mjs'));
  await writeFile(file, outputText);
  return import(pathToFileURL(file).href);
}

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    console.log(`  FAIL  ${name} ${detail}`);
    failures.push(name);
  }
}

console.log('\n[u1] 速さの計測: いちばん速い組み合わせの選び方');
{
  const { pickBest, gpuWithinNoise, median } = await load('src/core/perf/pick.ts');
  const describe = (item) => `${item.lanes}ページ・GPU${item.gpu ? 'あり' : 'なし'} ${item.ms}ms`;

  // 外部レビューで示された例: GPUありが最速だが、同じ同時数のGPUなしより速いGPUなしがほかにある
  const review = [
    { lanes: 1, gpu: false, ms: 100 },
    { lanes: 3, gpu: false, ms: 105 },
    { lanes: 3, gpu: true, ms: 98 },
  ];
  const picked = pickBest(review);
  check('GPUの差がぶれの範囲なら、いちばん速いGPUなしを選ぶ', picked.lanes === 1 && !picked.gpu, describe(picked));

  const clear = [
    { lanes: 1, gpu: false, ms: 100 },
    { lanes: 3, gpu: false, ms: 90 },
    { lanes: 3, gpu: true, ms: 70 },
  ];
  check('GPUがはっきり速ければGPUありを選ぶ', pickBest(clear).gpu === true, describe(pickBest(clear)));

  const cpuOnly = [
    { lanes: 1, gpu: false, ms: 120 },
    { lanes: 2, gpu: false, ms: 95 },
    { lanes: 3, gpu: false, ms: 99 },
  ];
  check('GPUを測っていなければ、いちばん速いものを選ぶ', pickBest(cpuOnly).lanes === 2, describe(pickBest(cpuOnly)));

  check('GPUを測っていなければ、ぶれの判定はしない', gpuWithinNoise(cpuOnly) === null);
  check('GPUの差がどれも1割未満なら、ぶれの範囲', gpuWithinNoise(review) === true);
  check('GPUの差が1割以上あれば、ぶれの範囲ではない', gpuWithinNoise(clear) === false);
  check('真ん中の値 (奇数個)', median([5, 1, 3]) === 3);
  check('真ん中の値 (偶数個)', median([4, 1, 3, 2]) === 2.5);
}

console.log('\n[u2] 少しずつ書き出すPDF');
{
  const { ImagePdfWriter } = await load('src/core/pdf/imagePdfWriter.ts');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const writer = new ImagePdfWriter('たまにPDF');
  // 並べて進めたときと同じく、順番を前後させて書く
  writer.addJpegPage(2, { jpeg, pixelWidth: 1, pixelHeight: 1, width: 300, height: 400 });
  writer.addJpegPage(0, { jpeg, pixelWidth: 1, pixelHeight: 1, width: 500, height: 600 });
  writer.addJpegPage(1, { jpeg, pixelWidth: 1, pixelHeight: 1, width: 595.28, height: 841.89 });
  const bytes = new Uint8Array(await writer.finish().arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  check('前後して書いても、ページはページ番号の順になる', doc.getPages().map((p) => Math.round(p.getWidth())).join(',') === '500,595,300');

  // 索引の各行が、その番号の部品の先頭を指しているか
  const text = Buffer.from(bytes).toString('latin1');
  const start = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split(/\s+/)[0]);
  const lines = text.slice(start).split('\n');
  const [first, count] = lines[1].split(' ').map(Number);
  let ok = text.slice(start, start + 4) === 'xref';
  for (let i = 0; i < count; i += 1) {
    const [offset, , kind] = lines[2 + i].trim().split(/\s+/);
    if (kind === 'n' && text.slice(Number(offset), Number(offset) + `${first + i} 0 obj`.length) !== `${first + i} 0 obj`) ok = false;
  }
  check('索引が部品の位置を正しく指している', ok);

  let threw = false;
  const incomplete = new ImagePdfWriter('x');
  incomplete.addJpegPage(1, { jpeg, pixelWidth: 1, pixelHeight: 1, width: 10, height: 10 });
  try {
    incomplete.finish();
  } catch {
    threw = true;
  }
  check('抜けたページがあれば書き出さない', threw);
}

await rm(work, { recursive: true, force: true });
console.log(`\n${failures.length === 0 ? 'すべて成功' : `${failures.length}件失敗: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
