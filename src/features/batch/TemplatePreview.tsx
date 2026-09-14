import { useCallback, useEffect, useRef, useState } from 'react';
import { alignRect, alignSummary, NO_ALIGNMENT, type AlignResult } from '../../core/pdf/align';
import { closePdf, openWithPdfjs, type PDFDocumentProxy } from '../../core/pdf/pdfjs';
import { REDACT_FILL } from '../../core/pdf/redact';
import { getPageSize, renderPageToCanvas } from '../../core/pdf/render';
import { estimateTemplateAlignment } from '../../core/pdf/templateAlign';
import { rectsForPage, type RedactTemplate } from '../../core/storage/templates';
import { IconButton } from '../../ui/Button';
import { ProgressBar } from '../../ui/primitives';

const RENDER_WIDTH = 1200;

export interface TemplatePreviewProps {
  file: File;
  template: RedactTemplate;
  /** 自動位置合わせを使うか (設定と同じ値を渡す) */
  autoAlign: boolean;
}

/**
 * テンプレートを当てた結果を、書き出す前に確かめるための表示。
 *
 * 実際の墨消しはせず、範囲を重ねて見せるだけ。
 * 書式がずれているPDFに気づかないまま一括で処理してしまう事故を防ぐのが目的なので、
 * 「どこが隠れるか」が分かれば足りる。
 */
export function TemplatePreview({ file, template, autoAlign }: TemplatePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const proxyRef = useRef<PDFDocumentProxy | null>(null);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [ratio, setRatio] = useState(595.28 / 841.89);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  // 実際の一括処理と同じ補正をかけて見せる。見たものと出るものを一致させるため。
  const [alignment, setAlignment] = useState<AlignResult>(NO_ALIGNMENT);

  useEffect(() => {
    let alive = true;
    setState('loading');
    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const proxy = await openWithPdfjs(bytes);
        if (!alive) {
          void closePdf(proxy);
          return;
        }
        proxyRef.current = proxy;
        setPageCount(proxy.numPages);
        setPageIndex(0);
        const result = await estimateTemplateAlignment(template, proxy, autoAlign).catch(() => NO_ALIGNMENT);
        if (!alive) return;
        setAlignment(result);
        setState('ready');
      } catch (error) {
        if (!alive) return;
        setMessage(error instanceof Error ? error.message : 'プレビューを表示できませんでした。');
        setState('error');
      }
    })();
    return () => {
      alive = false;
      void closePdf(proxyRef.current);
      proxyRef.current = null;
    };
  }, [file, template, autoAlign]);

  useEffect(() => {
    const proxy = proxyRef.current;
    const canvas = canvasRef.current;
    if (state !== 'ready' || !proxy || !canvas) return;
    const controller = new AbortController();

    (async () => {
      try {
        const size = await getPageSize(proxy, pageIndex);
        if (controller.signal.aborted) return;
        if (size.width > 0 && size.height > 0) setRatio(size.width / size.height);
        const offscreen = await renderPageToCanvas(proxy, pageIndex, {
          targetWidth: RENDER_WIDTH,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext('2d', { alpha: false })?.drawImage(offscreen, 0, 0);
        offscreen.width = 0;
        offscreen.height = 0;
      } catch {
        /* ページを1枚描けなくてもプレビュー自体は続けられる */
      }
    })();

    return () => controller.abort();
  }, [state, pageIndex]);

  const go = useCallback(
    (next: number) => setPageIndex(Math.min(Math.max(0, next), Math.max(0, pageCount - 1))),
    [pageCount],
  );

  if (state === 'loading') {
    return (
      <div className="stack">
        <ProgressBar />
        <span className="text-small muted">プレビューを準備しています…</span>
      </div>
    );
  }

  if (state === 'error') {
    return <p className="text-small">{message}</p>;
  }

  const applied = rectsForPage(template, pageIndex, pageCount).map((rect) => alignRect(rect, alignment));

  return (
    <div className="stack">
      <p className="text-small muted" style={{ marginBottom: 0 }}>
        「{file.name}」に「{template.name}」を当てたときに隠れる場所です。
        位置がずれていないか確かめてください。
      </p>

      <div className="preview-stage" style={{ ['--page-ratio' as string]: String(ratio) }}>
        <canvas className="preview-stage__canvas" ref={canvasRef} aria-label={`${pageIndex + 1}ページ目`} />
        {applied.map((rect, index) => (
          <div
            key={index}
            className="preview-rect"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              background: REDACT_FILL[rect.color],
            }}
          />
        ))}
      </div>

      <div className="redact-pager">
        <IconButton
          icon="chevron_left"
          label="前のページ"
          small
          disabled={pageIndex === 0}
          onClick={() => go(pageIndex - 1)}
        />
        <span className="redact-pager__label">
          {pageIndex + 1} / {pageCount}
        </span>
        <IconButton
          icon="chevron_right"
          label="次のページ"
          small
          disabled={pageIndex >= pageCount - 1}
          onClick={() => go(pageIndex + 1)}
        />
      </div>

      <p className="text-small muted" style={{ marginBottom: 0 }}>
        このページに当たる範囲: {applied.length}個
        {applied.length === 0 ? ' (このページには何も当たりません)' : ''}
        <br />
        自動位置合わせ: {alignSummary(alignment)}
        {alignment.reason === 'ok' ? ` ・ 一致度 ${Math.round(alignment.score * 100)}%` : ''}
      </p>
    </div>
  );
}
