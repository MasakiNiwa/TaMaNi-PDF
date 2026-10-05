import { parallelLanes } from '../perf/device';
import type { ReencodeRequest, ReencodeResponse } from './reencode.worker';

/**
 * 画像の刷り直しを、作業役 (Web Worker) に振り分ける。
 *
 * 作業役は必要になったときに立て、同時に進める数 (端末に合わせて決めた数) まで増やす。
 * しばらく使われなければ片付けて、メモリを返す。
 *
 * 作業役を使えない環境 (OffscreenCanvas が無い古いブラウザなど) や、作業役が
 * 失敗したときは null を返し、呼び出し側が画面のスレッドで同じことをやり直す。
 */

interface Slot {
  worker: Worker;
  busy: boolean;
}

const slots: Slot[] = [];
const waiting: Array<() => void> = [];
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** 使われないまま、この時間が過ぎたら作業役を片付ける */
const IDLE_MS = 30_000;

export function workerReencodeSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function spawn(): Slot {
  const worker = new Worker(new URL('./reencode.worker.ts', import.meta.url), {
    type: 'module',
    name: 'tamani-image',
  });
  const slot = { worker, busy: false };
  slots.push(slot);
  return slot;
}

function scheduleIdleCleanup(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (slots.some((slot) => slot.busy)) return;
    for (const slot of slots.splice(0)) slot.worker.terminate();
  }, IDLE_MS);
}

async function acquire(): Promise<Slot> {
  for (;;) {
    const free = slots.find((slot) => !slot.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    if (slots.length < Math.max(1, parallelLanes())) {
      const slot = spawn();
      slot.busy = true;
      return slot;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
}

function release(slot: Slot): void {
  slot.busy = false;
  waiting.shift()?.();
  scheduleIdleCleanup();
}

/** 作業役で画像を刷り直す。できなければ null。 */
export async function reencodeInWorker(
  file: Blob,
  preset: { maxEdge: number; quality: number },
): Promise<Uint8Array | null> {
  if (!workerReencodeSupported()) return null;
  let slot: Slot;
  try {
    slot = await acquire();
  } catch {
    return null;
  }
  const id = nextId++;
  try {
    return await new Promise<Uint8Array | null>((resolve) => {
      const onMessage = (event: MessageEvent<ReencodeResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        resolve(event.data.ok ? new Uint8Array(event.data.bytes) : null);
      };
      const onError = () => {
        cleanup();
        // 壊れた作業役は使い回さない
        const at = slots.indexOf(slot);
        if (at >= 0) slots.splice(at, 1);
        slot.worker.terminate();
        resolve(null);
      };
      const cleanup = () => {
        slot.worker.removeEventListener('message', onMessage);
        slot.worker.removeEventListener('error', onError);
      };
      slot.worker.addEventListener('message', onMessage);
      slot.worker.addEventListener('error', onError);
      const request: ReencodeRequest = { id, file, ...preset };
      slot.worker.postMessage(request);
    });
  } finally {
    release(slot);
  }
}
