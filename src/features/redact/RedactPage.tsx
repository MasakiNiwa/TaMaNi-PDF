import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppBarSlot } from '../../app/AppBarSlot';
import { hrefFor } from '../../app/routes';
import { useSettings } from '../../app/SettingsContext';
import { useHistoryState } from '../../app/useHistoryState';
import { useTemplates } from '../../app/TemplatesContext';
import { PdfUserError } from '../../core/pdf/errors';
import { closePdf, openWithPdfjs, type PDFDocumentProxy } from '../../core/pdf/pdfjs';
import { redactToPdf, type RedactColor } from '../../core/pdf/redact';
import { scopeLabel, scopeMatches, type PageScope, type TemplateRect } from '../../core/storage/templates';
import { saveBytes } from '../../core/util/download';
import { baseName } from '../../core/util/format';
import { createId } from '../../core/util/id';
import { AppBarAction } from '../../ui/AppBarAction';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { Banner, EmptyState, ProgressBar, Segmented } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';
import {
  DEFAULT_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  RedactStage,
  clampView,
  type Rect,
  type View,
} from './RedactStage';

type ScopeChoice = 'page' | 'all' | 'odd' | 'even' | 'last';

const SCOPE_OPTIONS: Array<{ value: ScopeChoice; label: string }> = [
  { value: 'page', label: 'このページのみ' },
  { value: 'all', label: '全ページ' },
  { value: 'odd', label: '奇数ページ' },
  { value: 'even', label: '偶数ページ' },
  { value: 'last', label: '最終ページ' },
];

/** ボタンで拡大縮小するときの刻み */
const ZOOM_FACTOR = 1.5;

function toScope(choice: ScopeChoice, pageIndex: number): PageScope {
  switch (choice) {
    case 'all':
      return { type: 'all' };
    case 'odd':
      return { type: 'odd' };
    case 'even':
      return { type: 'even' };
    case 'last':
      return { type: 'fromEnd', index: 0 };
    case 'page':
    default:
      return { type: 'index', index: pageIndex };
  }
}

interface LoadedPdf {
  name: string;
  bytes: Uint8Array;
  proxy: PDFDocumentProxy;
  pageCount: number;
}

export function RedactPage() {
  const snackbar = useSnackbar();
  const { settings } = useSettings();
  const templates = useTemplates();

  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  // 範囲は取り消し / やり直しの対象にする
  const history = useHistoryState<TemplateRect[]>([]);
  const rects = history.value;
  const [color, setColor] = useState<RedactColor>(settings.defaultRedactColor);
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>('page');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const stageRef = useRef<HTMLDivElement>(null);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => setColor(settings.defaultRedactColor), [settings.defaultRedactColor]);

  // 画面を離れるときに pdf.js のドキュメントを解放する
  const pdfRef = useRef<LoadedPdf | null>(null);
  pdfRef.current = pdf;
  useEffect(
    () => () => {
      void closePdf(pdfRef.current?.proxy);
      abortRef.current?.abort();
    },
    [],
  );

  const loadFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const proxy = await openWithPdfjs(bytes);
        void closePdf(pdfRef.current?.proxy);
        setPdf({ name: file.name, bytes, proxy, pageCount: proxy.numPages });
        setPageIndex(0);
        history.reset([]);
        setSelectedId(null);
        setView(DEFAULT_VIEW);
      } catch (error) {
        const message =
          error instanceof PdfUserError ? error.message : `「${file.name}」を読み込めませんでした。`;
        snackbar.error(message);
      }
    },
    [snackbar, history],
  );

  /** PDFを閉じて最初の画面へ戻す */
  const clearAll = useCallback(() => {
    void closePdf(pdfRef.current?.proxy);
    setPdf(null);
    history.reset([]);
    setSelectedId(null);
    setPageIndex(0);
    setView(DEFAULT_VIEW);
    setConfirmClear(false);
    snackbar.show('読み込んだPDFを閉じました。');
  }, [snackbar, history]);

  const pageCount = pdf?.pageCount ?? 0;

  const visibleRects = useMemo(
    () => rects.filter((rect) => scopeMatches(rect.scope, pageIndex, pageCount)),
    [rects, pageIndex, pageCount],
  );

  const addRect = useCallback(
    (draft: Rect) => {
      const id = createId('rect');
      history.commit((current) => [...current, { id, ...draft, color, scope: toScope(scopeChoice, pageIndex) }]);
      // 追加した直後から位置やサイズを直せるよう選択状態にする
      setSelectedId(id);
    },
    [color, scopeChoice, pageIndex, history],
  );

  /** ドラッグ中の追従。指を離すまで履歴には積まない。 */
  const updateRect = useCallback(
    (id: string, next: Rect) => {
      history.setLive((current) => current.map((rect) => (rect.id === id ? { ...rect, ...next } : rect)));
    },
    [history],
  );

  const removeRect = useCallback(
    (id: string) => {
      history.commit((current) => current.filter((rect) => rect.id !== id));
      setSelectedId((current) => (current === id ? null : current));
    },
    [history],
  );

  const goToPage = useCallback(
    (next: number) => {
      setPageIndex((current) => {
        const target = Math.min(Math.max(0, next), Math.max(0, pageCount - 1));
        return target === current ? current : target;
      });
      setSelectedId(null);
    },
    [pageCount],
  );

  /** ボタンでの拡大縮小。表示領域の中心を軸にする。 */
  const changeZoom = useCallback((direction: 1 | -1) => {
    const element = stageRef.current?.querySelector('.redact-viewport');
    const bounds = element?.getBoundingClientRect();
    setView((current) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)));
      if (!bounds) return { scale, x: 0, y: 0 };
      const cx = bounds.width / 2;
      const cy = bounds.height / 2;
      const anchorX = (cx - current.x) / current.scale;
      const anchorY = (cy - current.y) / current.scale;
      return clampView({ scale, x: cx - anchorX * scale, y: cy - anchorY * scale }, bounds.width, bounds.height);
    });
  }, []);

  const runRedaction = useCallback(async () => {
    if (!pdf || rects.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: pdf.pageCount });
    try {
      const bytes = await redactToPdf({
        bytes: pdf.bytes,
        proxy: pdf.proxy,
        rectsForPage: (index, count) => rects.filter((rect) => scopeMatches(rect.scope, index, count)),
        options: {
          dpi: settings.redactDpi,
          format: settings.redactFormat,
          jpegQuality: settings.jpegQuality,
        },
        onProgress: ({ pageIndex: done, pageCount: total }) => setProgress({ done, total }),
        signal: controller.signal,
      });
      saveBytes(bytes, `${baseName(pdf.name)}${settings.redactSuffix}.pdf`);
      snackbar.success('墨消ししたPDFを書き出しました。');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        snackbar.show('墨消しを中止しました。');
      } else {
        snackbar.error(error instanceof Error ? error.message : '墨消しに失敗しました。');
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }, [pdf, rects, settings, snackbar]);

  const saveTemplate = useCallback(() => {
    if (rects.length === 0) return;
    templates.create(templateName, rects, pageCount);
    setTemplateDialogOpen(false);
    setTemplateName('');
    snackbar.success('テンプレートを保存しました。');
  }, [rects, templateName, templates, pageCount, snackbar]);

  const applyTemplate = useCallback(
    (id: string) => {
      const template = templates.templates.find((item) => item.id === id);
      if (!template) return;
      // id を振り直して、元のテンプレートと編集中の範囲を切り離す
      history.commit(template.rects.map((rect) => ({ ...rect, id: createId('rect') })));
      setSelectedId(null);
      setTemplateDialogOpen(false);
      snackbar.success(`テンプレート「${template.name}」を読み込みました。`);
    },
    [templates.templates, snackbar, history],
  );

  return (
    <div className="page">
      {pdf ? (
        <AppBarSlot>
          <AppBarAction
            icon="undo"
            label="戻す"
            description="元に戻す"
            disabled={!history.canUndo}
            onClick={history.undo}
          />
          <AppBarAction
            icon="redo"
            label="やり直す"
            disabled={!history.canRedo}
            onClick={history.redo}
          />
          <AppBarAction
            icon="delete"
            label="クリア"
            description="クリアして最初に戻る"
            danger
            onClick={() => setConfirmClear(true)}
          />
        </AppBarSlot>
      ) : null}

      <header className="page__header">
        <h1 className="page__title">
          <Icon name="draw" size={24} />
          墨消し
        </h1>
        {/* 読み込んだあとは前置きを畳む。PDFに辿り着くまでのスクロールを短くするため。 */}
        {!pdf ? (
          <p className="page__lead">
            隠したい部分をドラッグで囲みます。全ページを画像に変換してから塗りつぶすので、下に隠れた文字も残りません。
          </p>
        ) : null}
      </header>

      <div className="stack" style={{ marginBottom: pdf ? 12 : 20 }}>
        <FileDrop
          accept="application/pdf"
          icon={pdf ? 'refresh' : 'upload'}
          compact={Boolean(pdf)}
          title={pdf ? '別のPDFに切り替える' : 'PDFをドラッグ&ドロップ、またはタップして選択'}
          hint={pdf ? `現在: ${pdf.name}` : '1つのPDFを読み込んで墨消しします。'}
          onFiles={loadFile}
        />
        {!pdf ? (
          <Banner tone="warning">
            出力されるPDFは<strong>画像として作り直した</strong>ものになります。文字検索・テキスト選択・しおり・注釈は失われます。
          </Banner>
        ) : null}
      </div>

      {!pdf ? (
        <EmptyState icon="draw" title="PDFを読み込んでください">
          読み込んだPDFはこの端末の中だけで処理されます。
        </EmptyState>
      ) : (
        <div className="redact-layout">
          <div>
            <div className="toolbar">
              <Segmented
                ariaLabel="墨消しの色"
                value={color}
                options={[
                  { value: 'black', label: '黒' },
                  { value: 'white', label: '白' },
                ]}
                onChange={setColor}
              />
              <select
                id="scope-select"
                className="select"
                style={{ width: 'auto', minWidth: 140 }}
                aria-label="範囲を適用するページ"
                value={scopeChoice}
                onChange={(event) => setScopeChoice(event.target.value as ScopeChoice)}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <span className="toolbar__divider" />

              <span className="redact-zoom">
                <IconButton
                  icon="zoom_out"
                  label="縮小"
                  small
                  disabled={view.scale <= MIN_ZOOM}
                  onClick={() => changeZoom(-1)}
                />
                <span className="redact-zoom__value">{Math.round(view.scale * 100)}%</span>
                <IconButton
                  icon="zoom_in"
                  label="拡大"
                  small
                  disabled={view.scale >= MAX_ZOOM}
                  onClick={() => changeZoom(1)}
                />
                <IconButton
                  icon="fit_screen"
                  label="幅に合わせる"
                  small
                  disabled={view.scale === 1 && view.x === 0 && view.y === 0}
                  onClick={() => setView(DEFAULT_VIEW)}
                />
              </span>

              {/*
                ページ送りとテンプレートは、以前はPDFの下に置いていた。
                スマホだと毎回PDFを通り越してスワイプする必要があったため、
                常に見えている位置 (画面上部に貼り付くツールバー) へ移した。
              */}
              {pageCount > 1 ? (
                <>
                  <span className="toolbar__divider" />
                  <span className="redact-pager">
                    <IconButton
                      icon="chevron_left"
                      label="前のページ"
                      small
                      disabled={pageIndex === 0}
                      onClick={() => goToPage(pageIndex - 1)}
                    />
                    <span className="redact-pager__label">
                      {pageIndex + 1} / {pageCount}
                    </span>
                    <IconButton
                      icon="chevron_right"
                      label="次のページ"
                      small
                      disabled={pageIndex >= pageCount - 1}
                      onClick={() => goToPage(pageIndex + 1)}
                    />
                  </span>
                </>
              ) : null}

              <span className="toolbar__divider" />
              <Button
                small
                variant="outlined"
                icon="save"
                onClick={() => {
                  if (!templateName) setTemplateName(baseName(pdf.name));
                  setTemplateDialogOpen(true);
                }}
              >
                テンプレート
              </Button>
            </div>

            <div ref={stageRef}>
              <RedactStage
                proxy={pdf.proxy}
                pageIndex={pageIndex}
                rects={visibleRects}
                drawColor={color}
                view={view}
                onViewChange={setView}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddRect={addRect}
                onUpdateRect={updateRect}
                onCommitRect={history.commitCurrent}
                onRemoveRect={removeRect}
              />
            </div>

            <p className="text-small muted" style={{ marginTop: 10 }}>
              ドラッグで範囲を追加。範囲をタップすると、動かしたり右下のつまみで大きさを変えたりできます。
              2本指でつまむと拡大・縮小、そのまま2本指を動かすと表示位置を移動できます。
            </p>

            <div style={{ marginTop: 12 }}>
              <Banner tone="warning">
                出力されるPDFは<strong>画像として作り直した</strong>ものになります。
                文字検索・テキスト選択・しおり・注釈は失われます。
              </Banner>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <Button variant="outlined" icon="delete" onClick={() => setConfirmClear(true)}>
                クリア
              </Button>
              <span className="spacer" />
              <Button
                variant="filled"
                icon="download"
                onClick={runRedaction}
                disabled={rects.length === 0 || progress !== null}
              >
                墨消しして書き出す
              </Button>
            </div>
          </div>

          <aside className="stack">
            <div className="card card--outlined">
              <h3 style={{ marginBottom: 8 }}>指定した範囲 ({rects.length})</h3>
              {rects.length === 0 ? (
                <p className="text-small muted">
                  プレビュー上をドラッグすると範囲を追加できます。細かく合わせたいときは拡大してから指定してください。
                </p>
              ) : (
                <div className="rect-list">
                  {rects.map((rect, index) => (
                    <div
                      className={`rect-list__item${rect.id === selectedId ? ' rect-list__item--selected' : ''}`}
                      key={rect.id}
                    >
                      <span className={`rect-list__swatch rect-list__swatch--${rect.color}`} aria-hidden="true" />
                      <button
                        type="button"
                        className="rect-list__label"
                        onClick={() => setSelectedId(rect.id)}
                        title="この範囲を選ぶ"
                      >
                        範囲{index + 1} ・ {scopeLabel(rect.scope)}
                      </button>
                      <IconButton icon="delete" label="削除" small danger onClick={() => removeRect(rect.id)} />
                    </div>
                  ))}
                </div>
              )}
              {rects.length > 0 ? (
                <div className="row" style={{ marginTop: 10 }}>
                  <Button
                    small
                    variant="outlined"
                    icon="delete"
                    onClick={() => {
                      history.commit([]);
                      setSelectedId(null);
                    }}
                  >
                    範囲をすべて消す
                  </Button>
                </div>
              ) : null}
            </div>

          </aside>
        </div>
      )}

      <Dialog
        open={templateDialogOpen}
        title="テンプレート"
        onClose={() => setTemplateDialogOpen(false)}
        actions={<Button onClick={() => setTemplateDialogOpen(false)}>閉じる</Button>}
      >
        <p className="text-small muted">
          同じ書式のPDFを繰り返し墨消しするなら、範囲をテンプレートとして保存しておくと次回そのまま使えます。
          <a href={hrefFor('batch')}>一括墨消し</a> でまとめて適用することもできます。
        </p>

        <h3 style={{ marginTop: 16, marginBottom: 8 }}>いまの範囲を保存する</h3>
        <div className="field">
          <label className="field__label" htmlFor="template-name">
            テンプレート名
          </label>
          <input
            id="template-name"
            className="input"
            value={templateName}
            maxLength={80}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="例: 〇〇社 請求書"
          />
          <span className="field__hint">
            {rects.length}個の範囲を保存します。この端末のブラウザにだけ保存されます。
          </span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button variant="tonal" icon="save" disabled={rects.length === 0} onClick={saveTemplate}>
            保存する
          </Button>
        </div>

        <h3 style={{ marginTop: 24, marginBottom: 8 }}>保存済みから呼び出す ({templates.templates.length})</h3>
        {templates.templates.length === 0 ? (
          <p className="text-small muted" style={{ marginBottom: 0 }}>
            まだテンプレートがありません。
          </p>
        ) : (
          <>
            <div className="template-list">
              {templates.templates.map((template) => (
                <div className="template-item" key={template.id}>
                  <div className="template-item__body">
                    <div className="template-item__name">{template.name}</div>
                    <div className="template-item__meta">
                      {template.rects.length}個の範囲
                      {template.sourcePageCount ? ` ・ 作成時 ${template.sourcePageCount}ページ` : ''}
                    </div>
                  </div>
                  <Button small variant="tonal" onClick={() => applyTemplate(template.id)}>
                    読み込む
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-small muted" style={{ marginTop: 12, marginBottom: 0 }}>
              読み込むと、いま指定している範囲は置き換わります。
            </p>
          </>
        )}
      </Dialog>

      <Dialog
        open={confirmClear}
        title="クリアしますか?"
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <Button onClick={() => setConfirmClear(false)}>キャンセル</Button>
            <Button variant="danger" onClick={clearAll}>
              クリアする
            </Button>
          </>
        }
      >
        <p style={{ marginBottom: 0 }}>
          読み込んだPDFと、指定した{rects.length}個の範囲を破棄して最初の画面に戻ります。
          保存済みのテンプレートは消えません。
        </p>
      </Dialog>

      <Dialog
        open={progress !== null}
        title="墨消ししています"
        persistent
        onClose={() => undefined}
        actions={
          <Button variant="danger" icon="stop" onClick={() => abortRef.current?.abort()}>
            中止
          </Button>
        }
      >
        <p className="text-small">{progress ? `${progress.done} / ${progress.total} ページ` : ''}</p>
        <ProgressBar value={progress?.done} max={progress?.total} />
        <p className="text-small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          ページ数が多いと時間がかかります。この間もファイルは端末の外に出ません。
        </p>
      </Dialog>
    </div>
  );
}
