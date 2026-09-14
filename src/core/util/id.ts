/** 衝突しない短いIDを作る。crypto.randomUUID が無い環境向けにフォールバックも持つ。 */
export function createId(prefix = ''): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${uuid}` : uuid;
}
