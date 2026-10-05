/**
 * 速さの計測結果から、いちばん速い組み合わせを選ぶ (計算だけで、ブラウザに頼らない)。
 *
 * GPUありがいちばん速くても、GPUなしのいちばん速いものとの差が測り方のぶれより小さいなら、
 * GPUなしを選ぶ。確かな差がないのに、仕組みの多いほうへ切り替える理由はないため。
 * 比べる相手は「同じ同時数のGPUなし」ではなく「GPUなしのいちばん速いもの」にする
 * (同じ同時数だけと比べると、ほかにもっと速いGPUなしがあっても見落とす)。
 */

export interface SpeedCase {
  lanes: number;
  gpu: boolean;
  ms: number;
}

/** これより差が小さいときは「測り方のぶれの範囲」とみなす (同じ設定でも1割前後ぶれた) */
export const NOISE = 0.1;

export function pickBest<T extends SpeedCase>(cases: readonly T[]): T {
  if (cases.length === 0) throw new Error('比べる結果がありません。');
  const fastest = cases.reduce((a, b) => (b.ms < a.ms ? b : a));
  if (!fastest.gpu) return fastest;
  const withoutGpu = cases.filter((item) => !item.gpu);
  if (withoutGpu.length === 0) return fastest;
  const fastestWithoutGpu = withoutGpu.reduce((a, b) => (b.ms < a.ms ? b : a));
  return (fastestWithoutGpu.ms - fastest.ms) / fastestWithoutGpu.ms < NOISE ? fastestWithoutGpu : fastest;
}

/** GPUありとなしの差が、どの同時数でもぶれの範囲か (GPUありを測っていなければ null) */
export function gpuWithinNoise(cases: readonly SpeedCase[]): boolean | null {
  const withGpu = cases.filter((item) => item.gpu);
  if (withGpu.length === 0) return null;
  return withGpu.every((on) => {
    const off = cases.find((item) => !item.gpu && item.lanes === on.lanes);
    return off ? Math.abs(on.ms - off.ms) / off.ms < NOISE : true;
  });
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
