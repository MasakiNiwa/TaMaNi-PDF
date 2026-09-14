import { useEffect, useRef, useState } from 'react';
import type { ThumbnailCache } from '../core/pdf/render';
import type { PdfSource } from '../core/pdf/types';
import { useInView } from './useInView';

/** サムネイル枠の縦横比 (高さ ÷ 幅)。A4縦より少し余裕を持たせている。 */
const BOX_RATIO = 1.35;

export interface PageThumbnailProps {
  cache: ThumbnailCache;
  source: PdfSource;
  pageIndex: number;
  /** 追加の回転角。CSSで見せるだけなので回しても再描画しない。 */
  rotation?: number;
  /** サムネイルを収める枠の幅 (px) */
  boxWidth: number;
  alt?: string;
}

/**
 * ページのサムネイル。
 *
 * 回転は画像の再生成ではなくCSSの transform で表現している。
 * 回転のたびに再レンダリングすると重く、ページ数が多いPDFで操作感が落ちるため。
 */
export function PageThumbnail({ cache, source, pageIndex, rotation = 0, boxWidth, alt }: PageThumbnailProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef);
  const [url, setUrl] = useState<string | undefined>(() => cache.get(source.id, pageIndex, boxWidth));

  useEffect(() => {
    setUrl(cache.get(source.id, pageIndex, boxWidth));
  }, [cache, source.id, pageIndex, boxWidth]);

  useEffect(() => {
    if (!inView || url) return;
    let alive = true;
    cache
      .load(source.proxy, source.id, pageIndex, boxWidth)
      .then((next) => {
        if (alive) setUrl(next);
      })
      .catch(() => {
        /* 1ページ描けなくても操作は続けられるので握りつぶす */
      });
    return () => {
      alive = false;
    };
  }, [cache, inView, url, source.proxy, source.id, pageIndex, boxWidth]);

  const quarterTurned = rotation === 90 || rotation === 270;

  return (
    <div
      className="thumb"
      ref={hostRef}
      // 幅を固定せず枠の上限として扱う。スマホの2列表示でもはみ出さないようにするため。
      style={{ width: '100%', maxWidth: boxWidth, aspectRatio: `1 / ${BOX_RATIO}` }}
    >
      {url ? (
        <img
          className="thumb__img"
          src={url}
          alt={alt ?? `${pageIndex + 1}ページ目のプレビュー`}
          // 90/270度回したときは縦横が入れ替わるので、収まる上限も入れ替える
          style={{
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
            maxWidth: quarterTurned ? `calc(100% * ${BOX_RATIO})` : '100%',
            maxHeight: quarterTurned ? `calc(100% / ${BOX_RATIO})` : '100%',
          }}
          draggable={false}
        />
      ) : (
        <div className="thumb__placeholder" aria-hidden="true" />
      )}
    </div>
  );
}
