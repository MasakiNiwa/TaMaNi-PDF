import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../../app/SettingsContext';
import { useTemplates } from '../../app/TemplatesContext';
import { PdfUserError } from '../../core/pdf/errors';
import { closePdf, openWithPdfjs, type PDFDocumentProxy } from '../../core/pdf/pdfjs';
import { redactToPdf, type RedactColor } from '../../core/pdf/redact';
import { scopeLabel, scopeMatches, type PageScope, type TemplateRect } from '../../core/storage/templates';
import { saveBytes } from '../../core/util/download';
import { baseName } from '../../core/util/format';
import { createId } from '../../core/util/id';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { Banner, EmptyState, ProgressBar, Segmented } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';
import { RedactStage } from './RedactStage';

type ScopeChoice = 'page' | 'all' | 'odd' | 'even' | 'last';

const SCOPE_OPTIONS: Array<{ value: ScopeChoice; label: string }> = [
  { value: 'page', label: 'このページのみ' },
  { value: 'all', label: '全ページ' },
  { value: 'odd', label: '奇数ページ' },
  { value: 'even', label: '偶数ページ' },
  { value: 'last', label: '最終ページ' },
];

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
  const [rects, setRects] = useState<TemplateRect[]>([]);
  const [color, setColor] = useState<RedactColor>(settings.defaultRedactColor);
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>('page');

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);

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
        setRects([]);
      } catch (error) {
        const message =
          error instanceof PdfUserError ? error.message : `「${file.name}」を読み込めませんでした。`;
        snackbar.error(message);
      }
    },
    [snackbar],
  );

  const pageCount = pdf?.pageCount ?? 0;

  const visibleRects = useMemo(
    () => rects.filter((rect) => scopeMatches(rect.scope, pageIndex, pageCount)),
    [rects, pageIndex, pageCount],
  );

  const addRect = useCallback(
    (draft: { x: number; y: number; w: number; h: number }) => {
      setRects((current) => [
        ...current,
        { id: createId('rect'), ...draft, color, scope: toScope(scopeChoice, pageIndex) },
      ]);
    },
    [color, scopeChoice, pageIndex],
  );

  const removeRect = useCallback((id: string) => {
    setRects((current) => current.filter((rect) => rect.id !== id));
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
    setSaveDialogOpen(false);
    setTemplateName('');
    snackbar.success('テンプレートを保存しました。');
  }, [rects, templateName, templates, pageCount, snackbar]);

  const applyTemplate = useCallback(
    (id: string) => {
      const template = templates.templates.find((item) => item.id === id);
      if (!template) return;
      // id を振り直して、元のテンプレートと編集中の範囲を切り離す
      setRects(template.rects.map((rect) => ({ ...rect, id: createId('rect') })));
      setLoadDialogOpen(false);
      snackbar.success(`テンプレート「${template.name}」を読み込みました。`);
    },
    [templates.templates, snackbar],
  );

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">
          <Icon name="draw" size={24} />
          墨消し
        </h1>
        <p className="page__lead">
          隠したい部分をドラッグで囲みます。全ページを画像に変換してから塗りつぶすので、下に隠れた文字も残りません。
        </p>
      </header>

      <div className="stack" style={{ marginBottom: 20 }}>
        <FileDrop
          accept="application/pdf"
          icon={pdf ? 'refresh' : 'upload'}
          compact={Boolean(pdf)}
          title={pdf ? `別のPDFに切り替える (現在: ${pdf.name})` : 'PDFをドラッグ&ドロップ、またはタップして選択'}
          hint={pdf ? undefined : '1つのPDFを読み込んで墨消しします。'}
          onFiles={loadFile}
        />
        <Banner tone="warning">
          出力されるPDFは<strong>画像として作り直した</strong>ものになります。文字検索・テキスト選択・しおり・注釈は失われます。
        </Banner>
      </div>

      {!pdf ? (
        <EmptyState icon="draw" title="PDFを読み込んでください">
          読み込んだPDFはこの端末の中だけで処理されます。
        </EmptyState>
      ) : (
        <div className="redact-layout">
          <div>
            <div className="toolbar">
              <span className="chip">塗る色</span>
              <Segmented
                ariaLabel="墨消しの色"
                value={color}
                options={[
                  { value: 'black', label: '黒' },
                  { value: 'white', label: '白' },
                ]}
                onChange={setColor}
              />
              <span className="toolbar__divider" />
              <label className="chip" htmlFor="scope-select">
                適用先
              </label>
              <select
                id="scope-select"
                className="select"
                style={{ width: 'auto', minWidth: 150 }}
                value={scopeChoice}
                onChange={(event) => setScopeChoice(event.target.value as ScopeChoice)}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

            <RedactStage
              proxy={pdf.proxy}
              pageIndex={pageIndex}
              rects={visibleRects}
              isOwnedByThisPage={(rect) => rect.scope.type === 'index' && rect.scope.index === pageIndex}
              drawColor={color}
              onAddRect={addRect}
              onRemoveRect={removeRect}
            />

            <div className="redact-pager">
              <IconButton
                icon="chevron_left"
                label="前のページ"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              />
              <span className="redact-pager__label">
                {pageIndex + 1} / {pageCount}
              </span>
              <IconButton
                icon="chevron_right"
                label="次のページ"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => setPageIndex((index) => Math.min(pageCount - 1, index + 1))}
              />
            </div>
          </div>

          <aside className="stack">
            <div className="card card--outlined">
              <h3 style={{ marginBottom: 8 }}>指定した範囲 ({rects.length})</h3>
              {rects.length === 0 ? (
                <p className="text-small muted">
                  プレビュー上をドラッグすると範囲を追加できます。追加した範囲は右上の × で消せます。
                </p>
              ) : (
                <div className="rect-list">
                  {rects.map((rect, index) => (
                    <div className="rect-list__item" key={rect.id}>
                      <span className={`rect-list__swatch rect-list__swatch--${rect.color}`} aria-hidden="true" />
                      <span className="spacer">
                        範囲{index + 1} ・ {scopeLabel(rect.scope)}
                      </span>
                      <IconButton icon="delete" label="削除" small danger onClick={() => removeRect(rect.id)} />
                    </div>
                  ))}
                </div>
              )}
              {rects.length > 0 ? (
                <div className="row" style={{ marginTop: 10 }}>
                  <Button small variant="outlined" icon="delete" onClick={() => setRects([])}>
                    すべて消す
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="card card--outlined">
              <h3 style={{ marginBottom: 8 }}>テンプレート</h3>
              <p className="text-small muted">
                同じ書式のPDFを繰り返し墨消しするなら、範囲をテンプレートとして保存しておくと次回そのまま使えます。
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <Button
                  small
                  variant="tonal"
                  icon="save"
                  disabled={rects.length === 0}
                  onClick={() => {
                    setTemplateName(baseName(pdf.name));
                    setSaveDialogOpen(true);
                  }}
                >
                  保存
                </Button>
                <Button
                  small
                  variant="outlined"
                  icon="upload"
                  disabled={templates.templates.length === 0}
                  onClick={() => setLoadDialogOpen(true)}
                >
                  呼び出し ({templates.templates.length})
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <Dialog
        open={saveDialogOpen}
        title="テンプレートとして保存"
        onClose={() => setSaveDialogOpen(false)}
        actions={
          <>
            <Button onClick={() => setSaveDialogOpen(false)}>キャンセル</Button>
            <Button variant="filled" onClick={saveTemplate}>
              保存する
            </Button>
          </>
        }
      >
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
          <span className="field__hint">{rects.length}個の範囲を保存します。この端末のブラウザにだけ保存されます。</span>
        </div>
      </Dialog>

      <Dialog open={loadDialogOpen} title="テンプレートを呼び出す" onClose={() => setLoadDialogOpen(false)}>
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
        <p className="text-small muted" style={{ marginTop: 12 }}>
          読み込むと、いま指定している範囲は置き換わります。
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
        <p className="text-small">
          {progress ? `${progress.done} / ${progress.total} ページ` : ''}
        </p>
        <ProgressBar value={progress?.done} max={progress?.total} />
        <p className="text-small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          ページ数が多いと時間がかかります。この間もファイルは端末の外に出ません。
        </p>
      </Dialog>
    </div>
  );
}
