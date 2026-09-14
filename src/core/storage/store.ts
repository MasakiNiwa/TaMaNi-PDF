/**
 * localStorage の薄いラッパー。
 *
 * 保存するのは設定とテンプレート (墨消し範囲の座標) だけで、
 * PDFの中身は一切保存しない。プライベートブラウズなどで localStorage が
 * 使えない環境でもアプリが壊れないように、失敗は握りつぶして既定値を返す。
 */
const PREFIX = 'tamani-pdf:';

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 使えない環境では何もしない */
  }
}

/** このアプリが保存したデータだけを消す */
export function clearAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* 使えない環境では何もしない */
  }
}

export function isStorageAvailable(): boolean {
  try {
    const probe = `${PREFIX}__probe__`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
