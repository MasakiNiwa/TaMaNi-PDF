import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { redactToPdf } from '../pdf/redact';
import { canvasToBlob } from '../pdf/render';
import {
  autoParallel,
  detectGpu,
  getPerfPreferences,
  setPerfPreferences,
  type GpuSetting,
} from './device';

/**
 * この端末で、どの並べ方がいちばん速いかを実際に測る。
 *
 * 並べて進める効き目もGPUの効き目も、端末とブラウザによって大きく違う
 * (GPUは、描くのは速くても画像として読み戻すのが遅い端末がある)。
 * 推測で決めるより、その端末で測って選ぶほうが確か。
 *
 * 測るのは、ここで作る見本のPDF (写真2ページ + 文字と線2ページ) で、
 * 利用者のPDFは使わない。結果もどこにも送らない。
 */

export interface BenchmarkCase {
  lanes: number;
  gpu: boolean;
  /** 何回か測った真ん中の値 (ミリ秒) */
  ms: number;
}

export interface BenchmarkResult {
  cases: BenchmarkCase[];
  best: BenchmarkCase;
  /** 1ページずつ・GPUなしのときと比べて、何%速くなったか */
  gainPercent: number;
  /**
   * 同じ同時数どうしで比べて、GPUのあり・なしの差が測り方のぶれより小さいか。
   * GPUを使えない端末 (比べていない) ときは null。
   */
  gpuWithinNoise: boolean | null;
}

/** 何周測るか。1周ごとにすべての組み合わせを1回ずつ測る */
const ROUNDS = 3;
/** これより差が小さいときは「測り方のぶれの範囲」とみなす (同じ設定でも1割前後ぶれた) */
const NOISE = 0.1;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function makeSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 2200;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('この環境ではキャンバスを利用できません。');
  for (let i = 0; i < 2; i += 1) {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, i === 0 ? '#2b5876' : '#355c7d');
    gradient.addColorStop(1, i === 0 ? '#c79081' : '#f67280');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let k = 0; k < 220; k += 1) {
      context.fillStyle = `hsla(${(k * 47) % 360}, 60%, 55%, 0.35)`;
      context.beginPath();
      context.arc((k * 173) % canvas.width, (k * 311) % canvas.height, 40 + ((k * 13) % 160), 0, Math.PI * 2);
      context.fill();
    }
    const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
    const image = await doc.embedJpg(jpeg);
    const page = doc.addPage([595.28, 818.5]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 818.5 });
  }
  canvas.width = 0;
  canvas.height = 0;

  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) {
    const page = doc.addPage([595.28, 841.89]);
    for (let row = 0; row < 90; row += 1) {
      page.drawText(`Sample line ${row + 1} - 1,234,567 JPY - quarterly report`, {
        x: 40,
        y: 800 - row * 8.6,
        size: 7,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    for (let k = 0; k < 120; k += 1) {
      page.drawLine({
        start: { x: 30 + ((k * 37) % 530), y: 40 + ((k * 53) % 760) },
        end: { x: 30 + ((k * 71) % 530), y: 40 + ((k * 29) % 760) },
        thickness: 0.6,
        color: rgb(0.3, 0.3, 0.6),
      });
    }
  }
  return doc.save();
}

/**
 * 測る。onProgress には「何通り目か / 全部で何通りか」を渡す。
 * 測っているあいだだけ設定を切り替え、終わったら元に戻す。
 */
export async function measureSpeed(
  onProgress?: (done: number, total: number) => void,
): Promise<BenchmarkResult> {
  const sample = await makeSample();
  const parallel = Math.max(2, autoParallel());
  const gpuChoices: GpuSetting[] = detectGpu().available ? ['off', 'auto'] : ['off'];
  const combos = [1, parallel].flatMap((lanes) => gpuChoices.map((gpu) => ({ lanes, gpu })));

  const saved = getPerfPreferences();
  const cases: BenchmarkCase[] = [];
  try {
    // 最初の1回は、作業役の立ち上げなどが混ざるので数えない
    setPerfPreferences({ parallel: 1, gpu: 'off' });
    await redactToPdf({ source: sample, rectsForPage: () => [], lanes: 1 });

    /*
     * 組み合わせを1つずつまとめて測ると、測っているあいだに端末が温まったり
     * 充電の具合が変わったりして、あとに測ったものほど不利 (や有利) になる。
     * そこで、全部の組み合わせを1回ずつ測る「周」を何周か回し、周ごとに順番を
     * 逆にして偏りを打ち消す。値は周ごとの真ん中を採る (1回だけ外れた値に引きずられない)。
     */
    const times: number[][] = combos.map(() => []);
    const total = combos.length * ROUNDS;
    let done = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = combos.map((_, index) => index);
      if (round % 2 === 1) order.reverse();
      for (const index of order) {
        onProgress?.(done, total);
        const combo = combos[index];
        setPerfPreferences({ parallel: saved.parallel, gpu: combo.gpu });
        const started = performance.now();
        await redactToPdf({ source: sample, rectsForPage: () => [], lanes: combo.lanes });
        times[index].push(performance.now() - started);
        done += 1;
      }
    }
    onProgress?.(total, total);
    for (const [index, combo] of combos.entries()) {
      cases.push({ lanes: combo.lanes, gpu: combo.gpu === 'auto', ms: Math.round(median(times[index])) });
    }
  } finally {
    setPerfPreferences(saved);
  }

  const baseline = cases.find((item) => item.lanes === 1 && !item.gpu) ?? cases[0];
  let best = cases.reduce((a, b) => (b.ms < a.ms ? b : a));
  // GPUありがいちばん速くても、同じ同時数のGPUなしとの差がぶれの範囲なら、GPUなしを選ぶ
  // (確かな差がないのに、仕組みの多いほうへ切り替える理由はないため)
  if (best.gpu) {
    const off = cases.find((item) => !item.gpu && item.lanes === best.lanes);
    if (off && (off.ms - best.ms) / off.ms < NOISE) best = off;
  }
  const gpuCases = cases.filter((item) => item.gpu);
  const gpuWithinNoise =
    gpuCases.length === 0
      ? null
      : gpuCases.every((on) => {
          const off = cases.find((item) => !item.gpu && item.lanes === on.lanes);
          return off ? Math.abs(on.ms - off.ms) / off.ms < NOISE : true;
        });
  return {
    cases,
    best,
    gainPercent: Math.max(0, Math.round((1 - best.ms / baseline.ms) * 100)),
    gpuWithinNoise,
  };
}
