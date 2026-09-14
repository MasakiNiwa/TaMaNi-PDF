import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { renderPageToCanvas } from '../../core/pdf/render';
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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** つまみの位置。n=上, s=下, w=左, e=右。 */
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_LABEL: Record<Handle, string> = {
  nw: '左上',
  n: '上',
  ne: '右上',
  e: '右',
  se: '右下',
  s: '下',
  sw: '左下',
  w: '左',
};

type Gesture =
  | { kind: 'create'; pointerId: number; originX: number; originY: number }
  | { kind: 'move'; pointerId: number; id: string; originX: number; originY: number; base: Rect }
  | { kind: 'resize'; pointerId: number; id: string; handle: Handle; originX: number; originY: number; base: Rect };

/** 共用体の各メンバーから同じキーを取り除く (そのまま Omit すると共通部分しか残らない) */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** つまみを引いたときの新しい矩形を求める。左右・上下が反転しても破綻しないように正規化する。 */
function resizeRect(base: Rect, handle: Handle, dx: number, dy: number): Rect {
  let left = base.x;
  let top = base.y;
  let right = base.x + base.w;
  let bottom = base.y + base.h;

  if (handle.includes('w')) left = clamp01(base.x + dx);
  if (handle.includes('e')) right = clamp01(base.x + base.w + dx);
  if (handle.includes('n')) top = clamp01(base.y + dy);
  if (handle.includes('s')) bottom = clamp01(base.y + base.h + dy);

  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return {
    x,
    y,
    w: Math.max(MIN_RECT_SIZE, Math.abs(right - left)),
    h: Math.max(MIN_RECT_SIZE, Math.abs(bottom - top)),
  };
}

export interface RedactStageProps {
  proxy: PDFDocumentProxy;
  pageIndex: number;
  /** このページに表示する範囲 */
  rects: TemplateRect[];
  drawColor: RedactColor;
  /** 表示倍率 (1 = 幅に合わせる) */
  zoom: number;
  /** true のとき範囲を操作せず、スワイプで表示位置を動かせるようにする */
  panMode: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddRect: (rect: Rect) => void;
  onUpdateRect: (id: string, rect: Rect) => void;
  onRemoveRect: (id: string) => void;
}

export function RedactStage({
  proxy,
  pageIndex,
  rects,
  drawColor,
  zoom,
  panMode,
  selectedId,
  onSelect,
  onAddRect,
  onUpdateRect,
  onRemoveRect,
}: RedactStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [rendering, setRendering] = useState(true);

  // 拡大したときは描き直して、拡大してもぼやけないようにする
  const renderWidth = Math.min(MAX_RENDER_WIDTH, Math.round(BASE_RENDER_WIDTH * Math.max(1, zoom)));

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

  /** ポインタ位置をページに対する 0〜1 の座標へ変換する */
  const toNormalized = useCallback((event: ReactPointerEvent) => {
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: clamp01((event.clientX - bounds.left) / bounds.width),
      y: clamp01((event.clientY - bounds.top) / bounds.height),
    };
  }, []);

  const beginGesture = (event: ReactPointerEvent, gesture: DistributiveOmit<Gesture, 'pointerId'>) => {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    gestureRef.current = { ...gesture, pointerId: event.pointerId } as Gesture;
  };

  const onOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panMode) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = toNormalized(event);
    if (!point) return;
    onSelect(null);
    beginGesture(event, { kind: 'create', originX: point.x, originY: point.y });
    setDraft({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onRectPointerDown = (event: ReactPointerEvent<HTMLDivElement>, rect: TemplateRect) => {
    if (panMode) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    const point = toNormalized(event);
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

  const onHandlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    rect: TemplateRect,
    handle: Handle,
  ) => {
    if (panMode) return;
    event.stopPropagation();
    const point = toNormalized(event);
    if (!point) return;
    onSelect(rect.id);
    beginGesture(event, {
      kind: 'resize',
      id: rect.id,
      handle,
      originX: point.x,
      originY: point.y,
      base: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = toNormalized(event);
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
        x: Math.min(Math.max(0, gesture.base.x + dx), 1 - gesture.base.w),
        y: Math.min(Math.max(0, gesture.base.y + dy), 1 - gesture.base.h),
      });
      return;
    }

    onUpdateRect(gesture.id, resizeRect(gesture.base, gesture.handle, dx, dy));
  };

  const endGesture = (event: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const target = event.currentTarget as Element;
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);

    if (gesture.kind === 'create' && draft) {
      if (draft.w >= MIN_RECT_SIZE && draft.h >= MIN_RECT_SIZE) onAddRect(draft);
    }
    setDraft(null);
  };

  return (
    <div className={`redact-stage-wrap${panMode ? ' redact-stage-wrap--pan' : ''}`}>
      <div className="redact-stage" style={{ width: `${Math.max(1, zoom) * 100}%` }}>
        <canvas className="redact-stage__canvas" ref={canvasRef} aria-label={`${pageIndex + 1}ページ目`} />

        <div
          className={`redact-stage__overlay${panMode ? ' redact-stage__overlay--pan' : ''}`}
          ref={overlayRef}
          onPointerDown={onOverlayPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          role="application"
          aria-label="ドラッグして墨消しする範囲を指定します。範囲をタップすると移動やサイズ変更ができます。"
        >
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
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveRect(rect.id);
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                    {HANDLES.map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        className={`redact-handle redact-handle--${handle}`}
                        aria-label={`${HANDLE_LABEL[handle]}のつまみ`}
                        onPointerDown={(event) => onHandlePointerDown(event, rect, handle)}
                        onPointerMove={onPointerMove}
                        onPointerUp={endGesture}
                        onPointerCancel={endGesture}
                      />
                    ))}
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
