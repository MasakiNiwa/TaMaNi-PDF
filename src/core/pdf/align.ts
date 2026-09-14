/**
 * 墨消しテンプレートの自動位置合わせ。
 *
 * 同じ書式のPDFでも、発行時期やスキャンのしかたで内容が少しずれることがある。
 * ずれたまま範囲を当てると隠したい文字がはみ出すので、テンプレートを作った
 * ときのページの「見え方」と、これから墨消しするページの「見え方」を見比べて、
 * ずれ (平行移動と拡大縮小) を推定して範囲をずらす。
 *
 * 保存するのは 96px 幅まで縮めた白黒の目安画像で、文字は読み取れない粗さ。
 * 端末の localStorage にだけ置き、ネットワークには一切出さない。
 */

/** テンプレートに保存する、基準ページの縮小画像 */
export interface PageFingerprint {
  width: number;
  height: number;
  /** 0〜255 の明るさ。長さは width * height */
  data: Uint8Array;
}

/** 保存形式 (JSONに載せるためbase64にしたもの) */
export interface StoredFingerprint {
  width: number;
  height: number;
  /** グレースケール画像のbase64 */
  data: string;
}

export type AlignReason =
  | 'ok'
  /** 自動位置合わせを使わない設定 */
  | 'disabled'
  /** テンプレートに基準画像がない (古いテンプレートなど) */
  | 'noAnchor'
  /** 用紙の縦横比が違いすぎる */
  | 'ratio'
  /** 似ている度合いが低く、ずらすとかえって危ない */
  | 'lowScore';

export interface AlignResult {
  /** ページ幅に対する割合での横のずれ */
  dx: number;
  /** ページ高さに対する割合での縦のずれ */
  dy: number;
  /** 拡大縮小の倍率 (1 でそのまま) */
  scale: number;
  /** -1〜1 の似ている度合い。1 に近いほど確か */
  score: number;
  /** 実際にずらしたか */
  applied: boolean;
  reason: AlignReason;
}

export const ALIGN_WIDTH = 96;

/** これを下回ったら、ずらさずそのまま当てる */
export const ALIGN_MIN_SCORE = 0.55;

/**
 * 位置合わせをしたときに範囲へ足す余白 (ページに対する割合)。
 *
 * 推定には必ず誤差が残るため、隠し漏らすくらいなら少し広めに塗る。
 */
export const ALIGN_MARGIN = 0.004;

export const NO_ALIGNMENT: AlignResult = {
  dx: 0,
  dy: 0,
  scale: 1,
  score: 0,
  applied: false,
  reason: 'disabled',
};

/** キャンバスの内容を縮小して、白黒の目安画像にする */
export function fingerprintFromCanvas(source: HTMLCanvasElement, width = ALIGN_WIDTH): PageFingerprint {
  const ratio = source.height / Math.max(1, source.width);
  const w = Math.max(8, Math.min(width, source.width));
  const h = Math.max(8, Math.round(w * ratio));

  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const context = small.getContext('2d', { alpha: false });
  if (!context) throw new Error('この環境ではキャンバスを利用できません。');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, w, h);
  // 縮小時にぼかしを効かせる。1画素ずつの拾い読みだと文字の有無が運任せになる。
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, w, h);

  const image = context.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i += 1) {
    const at = i * 4;
    // 人の目の感度に合わせた重みで明るさにする
    data[i] = Math.round(0.299 * image[at] + 0.587 * image[at + 1] + 0.114 * image[at + 2]);
  }
  small.width = 0;
  small.height = 0;
  return { width: w, height: h, data };
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 にする (btoa は環境によって大きな文字列で詰まるので自前で組む) */
export function encodeFingerprint(fingerprint: PageFingerprint): StoredFingerprint {
  const { data } = fingerprint;
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i];
    const b = i + 1 < data.length ? data[i + 1] : 0;
    const c = i + 2 < data.length ? data[i + 2] : 0;
    out += BASE64_CHARS[a >> 2];
    out += BASE64_CHARS[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < data.length ? BASE64_CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < data.length ? BASE64_CHARS[c & 63] : '=';
  }
  return { width: fingerprint.width, height: fingerprint.height, data: out };
}

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_CHARS.length; i += 1) table[BASE64_CHARS.charCodeAt(i)] = i;
  return table;
})();

/** base64 から戻す。壊れていたら null。 */
export function decodeFingerprint(stored: StoredFingerprint): PageFingerprint | null {
  const { width, height, data: text } = stored;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) return null;
  if (width * height > 400_000) return null;

  const expected = width * height;
  const data = new Uint8Array(expected);
  let at = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 61 /* = */) break;
    const value = code < 128 ? BASE64_LOOKUP[code] : -1;
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (at < expected) data[at] = (buffer >> bits) & 0xff;
      at += 1;
    }
  }
  if (at < expected) return null;
  return { width, height, data };
}

/** 縦横半分に縮める (粗い段階で当たりを付けるため) */
function halve(fingerprint: PageFingerprint): PageFingerprint {
  const w = Math.max(4, Math.floor(fingerprint.width / 2));
  const h = Math.max(4, Math.floor(fingerprint.height / 2));
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x * 2;
      const sy = y * 2;
      const p0 = fingerprint.data[sy * fingerprint.width + sx];
      const p1 = fingerprint.data[sy * fingerprint.width + Math.min(fingerprint.width - 1, sx + 1)];
      const p2 = fingerprint.data[Math.min(fingerprint.height - 1, sy + 1) * fingerprint.width + sx];
      const p3 =
        fingerprint.data[
          Math.min(fingerprint.height - 1, sy + 1) * fingerprint.width + Math.min(fingerprint.width - 1, sx + 1)
        ];
      data[y * w + x] = (p0 + p1 + p2 + p3) >> 2;
    }
  }
  return { width: w, height: h, data };
}

/**
 * 基準画像を (dx, dy, scale) だけ動かして重ねたときの、似ている度合い。
 *
 * 返すのは -1〜1 の相関係数。紙の白い部分が大半を占めるので、
 * 単純な差分ではなく「濃い場所の並び方が合っているか」を見る。
 */
function correlation(
  reference: PageFingerprint,
  target: PageFingerprint,
  dx: number,
  dy: number,
  scale: number,
): number {
  const rw = reference.width;
  const rh = reference.height;
  const tw = target.width;
  const th = target.height;
  // 目安画像どうしなので、基準側は間引かずに全画素を見る (数千画素しかない)
  const cx = rw / 2;
  const cy = rh / 2;
  const sx = tw / rw;
  const sy = th / rh;

  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;

  for (let y = 0; y < rh; y += 1) {
    const ty = Math.round(((y - cy) * scale + cy) * sy + dy * sy);
    if (ty < 0 || ty >= th) continue;
    for (let x = 0; x < rw; x += 1) {
      const tx = Math.round(((x - cx) * scale + cx) * sx + dx * sx);
      if (tx < 0 || tx >= tw) continue;
      // 白を0、濃いところを正の値として扱う
      const a = 255 - reference.data[y * rw + x];
      const b = 255 - target.data[ty * tw + tx];
      n += 1;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }

  if (n < 16) return -1;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va <= 0 || vb <= 0) return -1;
  return cov / Math.sqrt(va * vb);
}

/** 3点から放物線を当てはめて、頂点のずれを求める (画素より細かく合わせるため) */
function subPixel(before: number, center: number, after: number): number {
  const denominator = before - 2 * center + after;
  if (denominator >= 0) return 0;
  const shift = (0.5 * (before - after)) / denominator;
  return Math.abs(shift) <= 1 ? shift : 0;
}

export interface EstimateOptions {
  /** 探す範囲 (基準画像の幅に対する割合) */
  searchRatio?: number;
  /** 試す倍率 */
  scales?: number[];
  minScore?: number;
}

/**
 * 基準ページと対象ページを見比べて、ずれを推定する。
 *
 * 粗い画像で当たりを付けてから、元の細かさで詰める。
 * 全部を細かい画像で探すと計算量が跳ね上がるため。
 */
export function estimateAlignment(
  reference: PageFingerprint,
  target: PageFingerprint,
  options: EstimateOptions = {},
): AlignResult {
  const searchRatio = options.searchRatio ?? 0.12;
  const scales = options.scales ?? [0.96, 0.98, 1, 1.02, 1.04];
  const minScore = options.minScore ?? ALIGN_MIN_SCORE;

  const refRatio = reference.width / reference.height;
  const targetRatio = target.width / target.height;
  if (Math.abs(refRatio - targetRatio) / refRatio > 0.03) {
    return { dx: 0, dy: 0, scale: 1, score: 0, applied: false, reason: 'ratio' };
  }

  const coarseRef = halve(reference);
  const coarseTarget = halve(target);
  const coarseRange = Math.max(2, Math.round(coarseRef.width * searchRatio));

  let best = { dx: 0, dy: 0, scale: 1, score: -1 };
  for (const scale of scales) {
    for (let dy = -coarseRange; dy <= coarseRange; dy += 1) {
      for (let dx = -coarseRange; dx <= coarseRange; dx += 1) {
        const score = correlation(coarseRef, coarseTarget, dx, dy, scale);
        if (score > best.score) best = { dx, dy, scale, score };
      }
    }
  }

  // 粗い段階の1画素は、細かい段階の2画素ぶん
  let fine = { dx: best.dx * 2, dy: best.dy * 2, scale: best.scale, score: -1 };
  const fineScales = [fine.scale - 0.01, fine.scale, fine.scale + 0.01];
  const start = { dx: fine.dx, dy: fine.dy };
  for (const scale of fineScales) {
    for (let dy = start.dy - 2; dy <= start.dy + 2; dy += 1) {
      for (let dx = start.dx - 2; dx <= start.dx + 2; dx += 1) {
        const score = correlation(reference, target, dx, dy, scale);
        if (score > fine.score) fine = { dx, dy, scale, score };
      }
    }
  }

  // 画素の間まで詰める
  const left = correlation(reference, target, fine.dx - 1, fine.dy, fine.scale);
  const right = correlation(reference, target, fine.dx + 1, fine.dy, fine.scale);
  const up = correlation(reference, target, fine.dx, fine.dy - 1, fine.scale);
  const down = correlation(reference, target, fine.dx, fine.dy + 1, fine.scale);
  const dx = fine.dx + subPixel(left, fine.score, right);
  const dy = fine.dy + subPixel(up, fine.score, down);

  const applied = fine.score >= minScore;
  return {
    dx: dx / reference.width,
    dy: dy / reference.height,
    scale: fine.scale,
    score: fine.score,
    applied,
    reason: applied ? 'ok' : 'lowScore',
  };
}

export interface AlignableRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 推定したずれを範囲に反映する。
 *
 * 中央を基準に拡大縮小してから平行移動し、最後に少しだけ広げる。
 * 広げるのは、推定の誤差で隠し漏らすのを避けるため。
 */
export function alignRect<T extends AlignableRect>(rect: T, alignment: AlignResult, margin = ALIGN_MARGIN): T {
  if (!alignment.applied) return rect;
  const scale = alignment.scale;
  const x = (rect.x - 0.5) * scale + 0.5 + alignment.dx;
  const y = (rect.y - 0.5) * scale + 0.5 + alignment.dy;
  const w = rect.w * scale;
  const h = rect.h * scale;

  const left = Math.max(0, Math.min(1, x - margin));
  const top = Math.max(0, Math.min(1, y - margin));
  const right = Math.max(0, Math.min(1, x + w + margin));
  const bottom = Math.max(0, Math.min(1, y + h + margin));
  if (right <= left || bottom <= top) return rect;

  return { ...rect, x: left, y: top, w: right - left, h: bottom - top };
}

/** 画面に出す用の短い説明 */
export function alignSummary(alignment: AlignResult): string {
  switch (alignment.reason) {
    case 'ok': {
      const dx = Math.round(alignment.dx * 1000) / 10;
      const dy = Math.round(alignment.dy * 1000) / 10;
      const zoom = Math.round((alignment.scale - 1) * 1000) / 10;
      const moved = Math.abs(dx) >= 0.1 || Math.abs(dy) >= 0.1;
      const zoomed = Math.abs(zoom) >= 0.1;
      if (!moved && !zoomed) return 'ずれなし';
      const parts: string[] = [];
      if (moved) parts.push(`横${dx >= 0 ? '+' : ''}${dx}% ・ 縦${dy >= 0 ? '+' : ''}${dy}%`);
      if (zoomed) parts.push(`大きさ${zoom >= 0 ? '+' : ''}${zoom}%`);
      return `補正 ${parts.join(' / ')}`;
    }
    case 'lowScore':
      return '似た配置が見つからず、そのまま適用';
    case 'ratio':
      return '用紙の形が違うため、そのまま適用';
    case 'noAnchor':
      return '基準画像なし (そのまま適用)';
    case 'disabled':
    default:
      return 'オフ (設定でオンにできます)';
  }
}
