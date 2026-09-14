/** 同時実行数を制限して非同期処理を流すための最小限のキュー */
export function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const run = waiting.shift();
    if (!run) return;
    active += 1;
    run();
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}

/** UI のフリーズを避けるために描画フレームを1つ譲る */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
