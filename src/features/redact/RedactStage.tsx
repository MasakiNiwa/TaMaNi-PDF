import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { getPageSize, renderPageToCanvas } from '../../core/pdf/render';
import type { PDFDocumentProxy } from '../../core/pdf/pdfjs';
import type { RedactColor } from '../../core/pdf/redact';
import type { TemplateRect } from '../../core/storage/templates';
import { Icon } from '../../ui/Icon';

/** 等倍表示のときにページを描く幅 (px)。CSS側で縮小表示する。 */
const BASE_RENDER_WIDTH = 1400;
/** 拡大時に描き直す上限。上げすぎるとスマホのメモリを圧迫する。 */
const MAX_RENDER_WIDTH = 2600;
/** これより小さい範囲は誤操作とみなす (正規化座標) */
const MIN_RECT_SIZE = 0.006;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 表示位置。scale は倍率、offset は表示領域の左上から見たページ左上のずれ (px)。 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const DEFAULT_VIEW: View = { scale: 1, x: 0, y: 0 };

type Gesture =
  | { kind: 'create'; pointerId: number; originX: number; originY: number }
  | { kind: 'move'; pointerId: number; id: string; originX: number; originY: number; base: Rect }
  | { kind: 'resize'; pointerId: number; id: string; originX: number; originY: number; base: Rect };

/** 共用体の各メンバーから同じキーを取り除く (そのまま Omit すると共通部分しか残らない) */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * ページが表示領域から離れないように表示位置を丸める。
 * 等倍のときはぴったり収まるので、ずれは常に 0 になる。
 */
function clampView(view: View, viewWidth: number, viewHeight: number): View {
  const scale = clamp(view.scale, MIN_ZOOM, MAX_ZOOM);
  return {
    scale,
    x: clamp(view.x, viewWidth - viewWidth * scale, 0),
    y: clamp(view.y, viewHeight - viewHeight * scale, 0),
  };
}

export interface RedactStageProps {
  proxy: PDFDocumentProxy;
  pageIndex: number;
  /** このページに表示する範囲 */
  rects: TemplateRect[];
  drawColor: RedactColor;
  view: View;
  onViewChange: (view: View) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddRect: (rect: Rect) => void;
  /** ドラッグ中の追従。履歴には積まない。 */
  onUpdateRect: (id: string, rect: Rect) => void;
  /** 指を離してひと区切りついたとき */
  onCommitRect: () => void;
  onRemoveRect: (id: string) => void;
}

export function RedactStage({
  proxy,
  pageIndex,
  rects,
  drawColor,
  view,
  onViewChange,
  selectedId,
  onSelect,
  onAddRect,
  onUpdateRect,
  onCommitRect,
  onRemoveRect,
}: RedactStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** 画面に触れている指 (ピンチの判定に使う) */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number; view: View } | null>(null);

  const [draft, setDraft] = useState<Rect | null>(null);
  const [rendering, setRendering] = useState(true);
  const [aspect, setAspect] = useState(1.414);
  const [viewportWidth, setViewportWidth] = useState(0);

  // 表示領域の幅を測る。ページの縦横比と合わせて、等倍でちょうど収まる高さを決める。
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setViewportWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    getPageSize(proxy, pageIndex)
      .then((size) => {
        if (alive && size.width > 0) setAspect(size.height / size.width);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [proxy, pageIndex]);

  // 拡大したときは描き直して、拡大してもぼやけないようにする
  const renderWidth = Math.min(MAX_RENDER_WIDTH, Math.round(BASE_RENDER_WIDTH * Math.max(1, view.scale)));

  useEffect(() => {
    let alive = true;
    setRendering(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPageToCanvas(proxy, pageIndex, { targetWidth: renderWidth, canvas })
      .then(() => {
        if (alive) setRendering(false);
      })
      .catch(() => {
        if (alive) setRendering(false);
      });
    return () => {
      alive = false;
    };
  }, [proxy, pageIndex, renderWidth]);

  const viewportHeight = viewportWidth * aspect;

  /** ポインタ位置をページに対する 0〜1 の座標へ変換する (表示倍率とずれを打ち消す) */
  const toNormalized = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
      const localX = clientX - bounds.left - view.x;
      const localY = clientY - bounds.top - view.y;
      return {
        x: clamp01(localX / (bounds.width * view.scale)),
        y: clamp01(localY / (bounds.height * view.scale)),
      };
    },
    [view.x, view.y, view.scale],
  );

  const beginGesture = (event: ReactPointerEvent, gesture: DistributiveOmit<Gesture, 'pointerId'>) => {
    gestureRef.current = { ...gesture, pointerId: event.pointerId } as Gesture;
  };

  const trackPointer = (event: ReactPointerEvent) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewportRef.current?.setPointerCapture?.(event.pointerId);
  };

  /** 2本目の指が触れたらピンチに切り替える。作りかけの範囲は捨てる。 */
  const maybeStartPinch = () => {
    const points = [...pointersRef.current.values()];
    if (points.length !== 2) return false;
    gestureRef.current = null;
    setDraft(null);
    const [a, b] = points;
    pinchRef.current = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      view,
    };
    return true;
  };

  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    trackPointer(event);
    if (maybeStartPinch()) return;
    if (pointersRef.current.size > 2) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    onSelect(null);
    beginGesture(event, { kind: 'create', originX: point.x, originY: point.y });
    setDraft({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onRectPointerDown = (event: ReactPointerEvent<HTMLDivElement>, rect: TemplateRect) => {
    trackPointer(event);
    if (maybeStartPinch()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    onSelect(rect.id);
    beginGesture(event, {
      kind: 'move',
      id: rect.id,
      originX: point.x,
      originY: point.y,
      base: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    });
  };

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, rect: TemplateRect) => {
    trackPointer(event);
    if (maybeStartPinch()) return;
    event.stopPropagation();
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    onSelect(rect.id);
    beginGesture(event, {
      kind: 'resize',
      id: rect.id,
      originX: point.x,
      originY: point.y,
      base: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    // 2本指: ピンチで拡大縮小しつつ、指の中点に合わせて表示位置も動かす
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const scale = clamp((pinch.view.scale * distance) / pinch.distance, MIN_ZOOM, MAX_ZOOM);

      // つまみ始めた中点がページのどこを指していたか (拡大前の座標)
      const anchorX = (pinch.midX - bounds.left - pinch.view.x) / pinch.view.scale;
      const anchorY = (pinch.midY - bounds.top - pinch.view.y) / pinch.view.scale;
      // その点が今の指の中点に来るように置き直す。
      // これだけで、つまむ動き = 拡大縮小、2本指をずらす動き = 表示位置の移動 になる。
      onViewChange(
        clampView(
          {
            scale,
            x: midX - bounds.left - anchorX * scale,
            y: midY - bounds.top - anchorY * scale,
          },
          bounds.width,
          bounds.height,
        ),
      );
      return;
    }

    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - gesture.originX;
    const dy = point.y - gesture.originY;

    if (gesture.kind === 'create') {
      setDraft({
        x: Math.min(gesture.originX, point.x),
        y: Math.min(gesture.originY, point.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
      return;
    }

    if (gesture.kind === 'move') {
      // 動かしてもページの外へ出ないように留める
      onUpdateRect(gesture.id, {
        ...gesture.base,
        x: clamp(gesture.base.x + dx, 0, 1 - gesture.base.w),
        y: clamp(gesture.base.y + dy, 0, 1 - gesture.base.h),
      });
      return;
    }

    // 右下のつまみ: 左上を固定したまま幅と高さを変える
    onUpdateRect(gesture.id, {
      x: gesture.base.x,
      y: gesture.base.y,
      w: clamp(gesture.base.w + dx, MIN_RECT_SIZE, 1 - gesture.base.x),
      h: clamp(gesture.base.h + dy, MIN_RECT_SIZE, 1 - gesture.base.y),
    });
  };

  const endGesture = (event: ReactPointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;

    if (gesture.kind === 'create') {
      if (draft && draft.w >= MIN_RECT_SIZE && draft.h >= MIN_RECT_SIZE) onAddRect(draft);
    } else {
      onCommitRect();
    }
    setDraft(null);
  };

  /**
   * ホイール操作。
   * 等倍のときは何もせずページのスクロールに任せ、拡大中だけ表示位置を動かす。
   * Ctrl (Macは⌘) を押しながらだと拡大縮小になる。
   *
   * React の onWheel は passive で登録されるため preventDefault が効かず、
   * 表示位置を動かしながらページもスクロールしてしまう。
   * そのため下の useEffect で passive: false のリスナーとして自前で登録する。
   */
  const wheelRef = useRef<(event: WheelEvent) => void>(() => undefined);
  wheelRef.current = (event: WheelEvent) => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const scale = clamp(view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_ZOOM, MAX_ZOOM);
      const px = event.clientX - bounds.left;
      const py = event.clientY - bounds.top;
      const anchorX = (px - view.x) / view.scale;
      const anchorY = (py - view.y) / view.scale;
      onViewChange(clampView({ scale, x: px - anchorX * scale, y: py - anchorY * scale }, bounds.width, bounds.height));
      return;
    }

    if (view.scale <= MIN_ZOOM) return;
    event.preventDefault();
    onViewChange(
      clampView({ scale: view.scale, x: view.x - event.deltaX, y: view.y - event.deltaY }, bounds.width, bounds.height),
    );
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => wheelRef.current(event);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="redact-stage-wrap">
      <div
        className="redact-viewport"
        ref={viewportRef}
        style={{ height: viewportHeight > 0 ? viewportHeight : undefined }}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        role="application"
        aria-label="ドラッグして墨消しする範囲を指定します。2本指でつまむと拡大できます。"
      >
        <div
          className="redact-stage"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <canvas className="redact-stage__canvas" ref={canvasRef} aria-label={`${pageIndex + 1}ページ目`} />

          {rects.map((rect) => {
            const isSelected = rect.id === selectedId;
            const scoped = rect.scope.type !== 'index';
            return (
              <div
                key={rect.id}
                className={[
                  'redact-rect',
                  `redact-rect--${rect.color}`,
                  scoped ? 'redact-rect--scoped' : '',
                  isSelected ? 'redact-rect--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
                onPointerDown={(event) => onRectPointerDown(event, rect)}
              >
                {isSelected ? (
                  <>
                    <button
                      type="button"
                      className="redact-rect__remove"
                      aria-label="この範囲を削除"
                      title="この範囲を削除"
                      // 拡大しても操作部品の大きさは変えない
                      style={{ transform: `scale(${1 / view.scale})` }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveRect(rect.id);
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                    <button
                      type="button"
                      className="redact-handle"
                      aria-label="右下のつまみ (大きさを変える)"
                      title="ドラッグして大きさを変える"
                      style={{ transform: `scale(${1 / view.scale})` }}
                      onPointerDown={(event) => onHandlePointerDown(event, rect)}
                    />
                  </>
                ) : null}
              </div>
            );
          })}

          {draft ? (
            <div
              className={`redact-rect redact-rect--draft redact-rect--${drawColor}`}
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.w * 100}%`,
                height: `${draft.h * 100}%`,
              }}
            />
          ) : null}
        </div>

        {rendering ? (
          <div className="redact-stage__loading" aria-hidden="true">
            <span className="chip">読み込み中…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { clampView };
