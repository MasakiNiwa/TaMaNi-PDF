/**
 * まだ広く実装されていない新しい標準メソッドの補完。
 *
 * pdf.js 6.x は Map/WeakMap の upsert メソッド (`getOrInsert` / `getOrInsertComputed`) を
 * 使っているが、2026年時点でこれを積んでいるブラウザはごく一部しかない。
 * 補完しないと「PDFは開けるのにページを描画すると失敗する」という分かりにくい壊れ方をする。
 *
 * このファイルはメインスレッドと pdf.js のワーカーの両方で読み込む
 * (src/core/pdf/pdf.worker.entry.ts を参照)。
 */

interface UpsertMap<K, V> {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
}

function installUpsert(prototype: object): void {
  const target = prototype as UpsertMap<unknown, unknown> & {
    getOrInsert?: unknown;
    getOrInsertComputed?: unknown;
  };

  if (typeof target.getOrInsert !== 'function') {
    Object.defineProperty(target, 'getOrInsert', {
      configurable: true,
      writable: true,
      value: function getOrInsert<K, V>(this: UpsertMap<K, V>, key: K, value: V): V {
        if (this.has(key)) return this.get(key) as V;
        this.set(key, value);
        return value;
      },
    });
  }

  if (typeof target.getOrInsertComputed !== 'function') {
    Object.defineProperty(target, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function getOrInsertComputed<K, V>(this: UpsertMap<K, V>, key: K, compute: (key: K) => V): V {
        if (this.has(key)) return this.get(key) as V;
        const value = compute(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

installUpsert(Map.prototype);
installUpsert(WeakMap.prototype);

// Promise.withResolvers も pdf.js が使う。比較的新しいので念のため補完しておく。
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

export {};
