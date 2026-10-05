/**
 * 端末の力に合わせて、処理の並べ方を決める。
 *
 * ここで決めるのは「同時にいくつ進めるか」と「GPUに描かせるか」の2つだけ。
 * どちらも設定から上書きでき、既定 (自動) では端末の情報から決める。
 *
 * 端末について読むのは、ブラウザが誰にでも公開している値 (CPUの数・メモリの目安・
 * WebGLが使えるか) だけで、どこにも送らない。
 */

export type ParallelSetting = 'auto' | 1 | 2 | 3 | 4;
export type GpuSetting = 'auto' | 'off';

export interface PerfPreferences {
  parallel: ParallelSetting;
  gpu: GpuSetting;
}

let preferences: PerfPreferences = { parallel: 'auto', gpu: 'auto' };

/** 設定が変わったら呼ぶ (設定の共有状態から呼んでいる) */
export function setPerfPreferences(next: PerfPreferences): void {
  preferences = next;
}

export function getPerfPreferences(): PerfPreferences {
  return preferences;
}

export interface DeviceProfile {
  /** 論理コア数 (分からなければ 2 とみなす) */
  cores: number;
  /** メモリの目安 (GB)。Chrome系だけが教えてくれる。分からなければ null */
  memoryGb: number | null;
}

export function deviceProfile(): DeviceProfile {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const cores = nav?.hardwareConcurrency && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : 2;
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  return { cores, memoryGb: typeof memory === 'number' && memory > 0 ? memory : null };
}

/**
 * 自動のときに、同時に何ページ (何枚) 流すか。
 *
 * 計測 (4コア・GPUなしの端末、8ページ・150dpi) では、1ページずつに比べて
 * 2ページ同時で 16〜25%、3ページ同時で画像の多いPDFだけさらに数%速くなり、
 * 文字の多いPDFは3ページ同時だと少し戻った。4以上は伸びなかった。
 * そこで、コアに余裕のある端末だけ3、それ以外は2にしている。
 * 1ページぶんの作業用の画面 (A4・150dpiで約9MB) が同時に増えるので、
 * メモリの少ない端末では控えめにする。
 */
export function autoParallel(profile: DeviceProfile = deviceProfile()): number {
  let lanes = profile.cores >= 6 ? 3 : profile.cores >= 3 ? 2 : 1;
  if (profile.memoryGb !== null) {
    if (profile.memoryGb <= 1) lanes = 1;
    else if (profile.memoryGb <= 2) lanes = Math.min(lanes, 2);
  }
  return lanes;
}

/** いまの設定で、同時にいくつ進めるか */
export function parallelLanes(): number {
  const setting = preferences.parallel;
  return setting === 'auto' ? autoParallel() : setting;
}

export interface GpuInfo {
  /** ブラウザがGPUで描けると言っているか */
  available: boolean;
  /** 使えるが、実体がソフトウェア描画 (GPUの代わりにCPUで真似ている) らしい */
  software: boolean;
}

let gpuCache: GpuInfo | null = null;

/**
 * GPUで描けそうかを調べる。
 *
 * WebGL が作れるかで判断する。作れても中身がソフトウェア描画
 * (SwiftShader など) のときは、GPUに任せても速くならないので使えない扱いにする。
 * 一度調べたら覚えておく。
 */
export function detectGpu(): GpuInfo {
  if (gpuCache) return gpuCache;
  let info: GpuInfo = { available: false, software: false };
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
      const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
      info = { available: !software, software };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    info = { available: false, software: false };
  }
  gpuCache = info;
  return info;
}

/** いまの設定で、GPUに描かせるか */
export function useGpu(): boolean {
  if (preferences.gpu === 'off') return false;
  return detectGpu().available;
}

/**
 * 2D の描画面を取り出す。
 *
 * 描画面の性質は最初に取り出したときに決まり、あとから変えられない。
 * GPUを使わないときは「よく読み出す」印を付けて、最初からCPU側に置く
 * (画像として書き出すとき、GPUから読み戻す手間が要らなくなる)。
 */
export function context2d(canvas: HTMLCanvasElement, gpu: boolean = useGpu()): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { alpha: false, willReadFrequently: !gpu });
}
