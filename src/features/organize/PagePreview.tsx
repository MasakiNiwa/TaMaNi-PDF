import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderPageToCanvas } from '../../core/pdf/render';
import type { PageRef, PdfSource } from '../../core/pdf/types';
import { Button, IconButton } from '../../ui/Button';
import { useFocusTrap } from '../../ui/useFocusTrap';

/**
 * 1ページだけを画面いっぱいに出して、中身を確かめるための表示。
 *
 * 一覧のサムネイルを大きくする手もあるが、スマホではカードの枠 (番号・つまみ・
 * チェック・操作ボタン) が場所を取り、中身を読める大きさまでは広げられなかった。
 * そこで、確かめたいときだけ全画面に出す形にしている。
 *
 * ページは最初から大きめに描いておき、拡大縮小は描き直さずに transform で行う。
 * 拡大のたびに描き直すと、指を動かしているあいだ画面がちらつくため。
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** 描いておく幅 (px)。画面幅の数倍にしておくと、拡大しても粗さが出にくい。 */
const RENDER_WIDTH = 1600;

interface View {
  scale: number;
  x: number;
  y: number;
}

const RESET_VIEW: View = { scale: 1, x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 枠と中身の大きさ (中身は拡大前の値) */
interface Box {
  frameWidth: number;
  frameHeight: number;
  contentWidth: number;
  contentHeight: number;
}

/**
 * 中身が枠から流れ出さないように押しとどめる。
 *
 * 枠と中身の大きさは違う (紙は枠の中に余白付きで収まっている) ので、
 * 枠の大きさだけで計算すると、動かせる量が実際と合わない。
 */
function clampAxis(offset: number, frameSize: number, contentSize: number, scale: number): number {
  const scaled = contentSize * scale;
  // 中身は枠の中央に置かれているので、その位置を基準にする
  const base = ((frameSize - contentSize) / 2) * scale;
  // 収まっているあいだは動かさず、中央のまま
  if (scaled <= frameSize) return (frameSize - scaled) / 2 - base;
  return clamp(offset, -base - (scaled - frameSize), -base);
}

function clampView(view: View, box: Box): View {
  const scale = clamp(view.scale, MIN_ZOOM, MAX_ZOOM);
  if (box.contentWidth <= 0 || box.contentHeight <= 0) return { scale, x: 0, y: 0 };
  return {
    scale,
    x: clampAxis(view.x, box.frameWidth, box.contentWidth, scale),
    y: clampAxis(view.y, box.frameHeight, box.contentHeight, scale),
  };
}

export interface PagePreviewProps {
  page: PageRef;
  source: PdfSource;
  index: number;
  total: number;
  selected: boolean;
  onClose: () => void;
  onNavigate: (delta: number) => void;
  /** 渡さなければ、そのボタンは出さない (追加前の確認など、見るだけのとき) */
  onRotate?: (delta: number) => void;
  onDelete?: () => void;
  onToggleSelect?: () => void;
}

export function PagePreview({
  page,
  source,
  index,
  total,
  selected,
  onClose,
  onNavigate,
  onRotate,
  onDelete,
  onToggleSelect,
}: PagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(RESET_VIEW);
  const [loading, setLoading] = useState(true);
  /** ページの縦横比 (幅 ÷ 高さ) */
  const [ratio, setRatio] = useState(1 / Math.SQRT2);
  /**
   * 枠に収まる大きさ。CSSの max-height 任せにすると、
   * 入れ子の都合で効かないことがあり、紙の下が切れて確かめられなくなる。
   * 収まる大きさは自分で決める。
   */
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);

  // 枠の大きさが決まったら (画面の回転や窓の大きさ変更でも) 収まる大きさを出し直す
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      const box = frame.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const width = Math.min(box.width, box.height * ratio);
      setFit({ width, height: width / ratio });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ratio]);

  /** いまの枠と中身の大きさ。拡大の押しとどめに使う。 */
  const measure = useCallback((): Box => {
    const frame = frameRef.current?.getBoundingClientRect();
    const canvas = canvasRef.current;
    return {
      frameWidth: frame?.width ?? 0,
      frameHeight: frame?.height ?? 0,
      // offsetWidth は transform の影響を受けないので、拡大前の大きさが取れる
      contentWidth: canvas?.offsetWidth ?? 0,
      contentHeight: canvas?.offsetHeight ?? 0,
    };
  }, []);

  // 収まる大きさが変わったら、いまの位置もその中へ入れ直す
  useEffect(() => {
    if (!fit) return;
    setView((current) => clampView(current, measure()));
  }, [fit, measure]);

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number; view: View } | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; view: View } | null>(null);
  const lastTapRef = useRef(0);

  // ページが変わったら、拡大はいったん戻す
  useEffect(() => setView(RESET_VIEW), [page.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    setLoading(true);

    (async () => {
      try {
        const offscreen = await renderPageToCanvas(source.proxy, page.sourceIndex, {
          rotation: page.rotation,
          targetWidth: RENDER_WIDTH,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext('2d', { alpha: false })?.drawImage(offscreen, 0, 0);
        offscreen.width = 0;
        offscreen.height = 0;
        setRatio(canvas.width / Math.max(1, canvas.height));
        setLoading(false);
      } catch {
        /* 描けないページでも、閉じて戻れるようにしておく */
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [source.proxy, page.sourceIndex, page.rotation, page.id]);

  // 焦点の面倒 (初期位置・Tabの循環・閉じたあとの戻し) はダイアログと同じ扱いにする
  useFocusTrap(true, overlayRef, { onEscape: onClose });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') onNavigate(1);
      else if (event.key === 'ArrowLeft') onNavigate(-1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onNavigate]);

  const zoomBy = useCallback(
    (factor: number) => {
      const box = measure();
      setView((current) => {
        const scale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
        // 画面の中心を軸にする
        const cx = box.frameWidth / 2;
        const cy = box.frameHeight / 2;
        const anchorX = (cx - current.x) / current.scale;
        const anchorY = (cy - current.y) / current.scale;
        return clampView({ scale, x: cx - anchorX * scale, y: cy - anchorY * scale }, box);
      });
    },
    [measure],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    // ページ送りのボタンの上から始まったときは触らない。
    // ここで捕まえると、ボタンが押された扱いにならなくなる。
    if ((event.target as HTMLElement).closest('button')) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    frameRef.current?.setPointerCapture?.(event.pointerId);

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        view,
      };
      panRef.current = null;
      return;
    }

    // 2回続けて軽く叩いたら、拡大と等倍を行き来する
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      zoomBy(view.scale > 1.2 ? 1 / view.scale : 2.5);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }

    if (view.scale > 1) {
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const box = measure();

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const scale = clamp((pinch.view.scale * distance) / pinch.distance, MIN_ZOOM, MAX_ZOOM);
      // つまみ始めた中点が指していた場所を、いまの中点に合わせ直す
      const anchorX = (pinch.midX - bounds.left - pinch.view.x) / pinch.view.scale;
      const anchorY = (pinch.midY - bounds.top - pinch.view.y) / pinch.view.scale;
      setView(
        clampView(
          { scale, x: midX - bounds.left - anchorX * scale, y: midY - bounds.top - anchorY * scale },
          box,
        ),
      );
      return;
    }

    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      setView(
        clampView(
          {
            scale: pan.view.scale,
            x: pan.view.x + (event.clientX - pan.x),
            y: pan.view.y + (event.clientY - pan.y),
          },
          box,
        ),
      );
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };

  return createPortal(
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${index + 1}ページ目の拡大表示`}
      tabIndex={-1}
      ref={overlayRef}
    >
      <div className="preview-overlay__bar">
        <span className="preview-overlay__title">
          {index + 1} / {total} ・ {source.name}
        </span>
        <span className="spacer" />
        <IconButton icon="zoom_out" label="縮小" onClick={() => zoomBy(1 / 1.6)} />
        <span className="preview-overlay__zoom">{Math.round(view.scale * 100)}%</span>
        <IconButton icon="zoom_in" label="拡大" onClick={() => zoomBy(1.6)} />
        <IconButton icon="close" label="閉じる" onClick={onClose} />
      </div>

      <div
        className="preview-overlay__frame"
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="preview-overlay__inner"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <canvas
            className="preview-overlay__canvas"
            ref={canvasRef}
            style={fit ? { width: `${fit.width}px`, height: `${fit.height}px` } : undefined}
            aria-label={`${index + 1}ページ目`}
          />
        </div>
        {loading ? <span className="preview-overlay__loading">描いています…</span> : null}

        {/* ページ送りは左右の端に置く。下に並べると小さい画面で折り返すため。 */}
        <span className="preview-overlay__nav preview-overlay__nav--prev">
          <IconButton
            icon="chevron_left"
            label="前のページ"
            filled
            disabled={index === 0}
            onClick={() => onNavigate(-1)}
          />
        </span>
        <span className="preview-overlay__nav preview-overlay__nav--next">
          <IconButton
            icon="chevron_right"
            label="次のページ"
            filled
            disabled={index >= total - 1}
            onClick={() => onNavigate(1)}
          />
        </span>
      </div>

      <div className="preview-overlay__actions">
        {onRotate ? (
          <>
            <IconButton icon="rotate_left" label="左に回転" onClick={() => onRotate(-90)} />
            <IconButton icon="rotate_right" label="右に回転" onClick={() => onRotate(90)} />
          </>
        ) : null}
        {onToggleSelect ? (
          <Button small variant={selected ? 'tonal' : 'outlined'} icon="check" onClick={onToggleSelect}>
            {selected ? '選択中' : '選択'}
          </Button>
        ) : null}
        {onDelete ? (
          <Button small variant="danger" icon="delete" onClick={onDelete}>
            削除
          </Button>
        ) : null}
        <Button small onClick={onClose}>
          一覧に戻る
        </Button>
      </div>
    </div>,
    document.body,
  );
}
