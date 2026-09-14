import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { renderPageToCanvas } from '../../core/pdf/render';
import type { PDFDocumentProxy } from '../../core/pdf/pdfjs';
import type { RedactColor } from '../../core/pdf/redact';
import type { TemplateRect } from '../../core/storage/templates';
import { Icon } from '../../ui/Icon';

/** 表示用にページを描く幅。CSS側で縮小表示するので実寸はこれで固定して良い。 */
const STAGE_RENDER_WIDTH = 1400;
/** これより小さい範囲は誤操作とみなす (正規化座標) */
const MIN_RECT_SIZE = 0.004;

interface Draft {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactStageProps {
  proxy: PDFDocumentProxy;
  pageIndex: number;
  /** このページに表示する範囲 */
  rects: TemplateRect[];
  /** 「このページのみ」ではない範囲は消せないようにするために使う */
  isOwnedByThisPage: (rect: TemplateRect) => boolean;
  drawColor: RedactColor;
  onAddRect: (rect: Draft) => void;
  onRemoveRect: (id: string) => void;
}

export function RedactStage({
  proxy,
  pageIndex,
  rects,
  isOwnedByThisPage,
  drawColor,
  onAddRect,
  onRemoveRect,
}: RedactStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let alive = true;
    setRendering(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPageToCanvas(proxy, pageIndex, { targetWidth: STAGE_RENDER_WIDTH, canvas })
      .then(() => {
        if (alive) setRendering(false);
      })
      .catch(() => {
        if (alive) setRendering(false);
      });
    return () => {
      alive = false;
    };
  }, [proxy, pageIndex]);

  /** ポインタ位置をページに対する 0〜1 の座標へ変換する */
  const toNormalized = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const point = toNormalized(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = point;
    setDraft({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const point = toNormalized(event);
    if (!point) return;
    setDraft({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    });
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || !draft) {
      setDraft(null);
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (draft.w >= MIN_RECT_SIZE && draft.h >= MIN_RECT_SIZE) {
      onAddRect(draft);
    }
    setDraft(null);
  };

  return (
    <div className="redact-stage-wrap">
      <div className="redact-stage">
        <canvas className="redact-stage__canvas" ref={canvasRef} aria-label={`${pageIndex + 1}ページ目`} />

        <div
          className="redact-stage__overlay"
          ref={overlayRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          role="application"
          aria-label="ドラッグして墨消しする範囲を指定します"
        >
          {rects.map((rect) => {
            const owned = isOwnedByThisPage(rect);
            return (
              <div
                key={rect.id}
                className={`redact-rect redact-rect--${rect.color}${owned ? '' : ' redact-rect--inherited'}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              >
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
          <div className="redact-stage__overlay" style={{ display: 'grid', placeItems: 'center' }} aria-hidden="true">
            <span className="chip">読み込み中…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
