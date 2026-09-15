import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { AppBarSlot } from '../../app/AppBarSlot';
import { useSettings } from '../../app/SettingsContext';
import { useUnloadGuard } from '../../app/useUnloadGuard';
import { useTemplates } from '../../app/TemplatesContext';
import { hrefFor } from '../../app/routes';
import { alignRect, alignSummary } from '../../core/pdf/align';
import { closePdf, openWithPdfjs } from '../../core/pdf/pdfjs';
import { redactToPdf } from '../../core/pdf/redact';
import { estimateTemplateAlignment } from '../../core/pdf/templateAlign';
import { countAppliedRects, rectsForPage, scopeLabel, unmatchedScopes } from '../../core/storage/templates';
import { saveBytes } from '../../core/util/download';
import { baseName, formatBytes, sanitizeFileName } from '../../core/util/format';
import { createId } from '../../core/util/id';
import { AppBarAction } from '../../ui/AppBarAction';
import { Button, IconButton } from '../../ui/Button';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { Banner, EmptyState, ProgressBar } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';
import { TemplatePreview } from './TemplatePreview';

type JobStatus = 'waiting' | 'running' | 'done' | 'error';

/**
 * 出来上がったPDFが「どの条件で作られたか」を表す文字列。
 *
 * テンプレートや画質を変えたあとに、前の条件で作ったPDFが
 * そのまま残って保存されてしまうのを防ぐために持っておく。
 */
function conditionOf(templateId: string, settings: { redactDpi: number; redactFormat: string; jpegQuality: number }, autoAlign: boolean): string {
  return [templateId, settings.redactDpi, settings.redactFormat, settings.jpegQuality, autoAlign].join('|');
}

interface Job {
  id: string;
  file: File;
  status: JobStatus;
  message?: string;
  /** 自動位置合わせの結果 (画面に出す短い説明) */
  align?: string;
  /** この結果を作ったときの条件 */
  condition?: string;
  outputName?: string;
  output?: Uint8Array;
}

export function BatchPage() {
  const snackbar = useSnackbar();
  const { settings } = useSettings();
  const { templates } = useTemplates();

  const [templateId, setTemplateId] = useState<string>('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [pageProgress, setPageProgress] = useState<{ done: number; total: number } | null>(null);
  /** 書き出す前にテンプレートの当たり位置を確かめるためのファイル */
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const template = useMemo(
    () => templates.find((item) => item.id === templateId),
    [templates, templateId],
  );

  const condition = conditionOf(templateId, settings, settings.templateAutoAlign);

  /**
   * 条件が変わったら、前の条件で作った結果は捨てる。
   *
   * 残したままだと、画面はテンプレートBを選んでいるのに
   * Aで作ったPDFを保存する (ZIPに混ざる) ことになる。
   */
  useEffect(() => {
    if (running) return;
    setJobs((current) => {
      if (!current.some((job) => job.status === 'done' && job.condition !== condition)) return current;
      return current.map((job) =>
        job.status === 'done' && job.condition !== condition
          ? {
              ...job,
              status: 'waiting' as JobStatus,
              output: undefined,
              outputName: undefined,
              align: undefined,
              condition: undefined,
              message: '条件が変わったので、もう一度実行してください',
            }
          : job,
      );
    });
  }, [condition, running]);

  const addFiles = useCallback((files: File[]) => {
    setJobs((current) => [
      ...current,
      ...files.map((file) => ({ id: createId('job'), file, status: 'waiting' as JobStatus })),
    ]);
  }, []);

  const removeJob = useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }, []);

  const run = useCallback(async () => {
    if (!template || jobs.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);

    // 1ファイルずつ順番に処理する。まとめて並列に走らせるとメモリを使い切りやすいため。
    for (const job of jobs) {
      if (controller.signal.aborted) break;
      if (job.status === 'done') continue;
      patchJob(job.id, { status: 'running', message: undefined });
      setPageProgress(null);
      let proxy;
      try {
        const bytes = new Uint8Array(await job.file.arrayBuffer());
        proxy = await openWithPdfjs(bytes);

        // 当たる範囲が1つもないまま画像化すると、
        // 「墨消しできたつもりで、何も隠れていないPDF」が出来てしまう。
        const applied = countAppliedRects(template, proxy.numPages);
        if (applied === 0) {
          const scopes = unmatchedScopes(template, proxy.numPages).map(scopeLabel).join('・');
          patchJob(job.id, {
            status: 'error',
            message: `このPDF (${proxy.numPages}ページ) には当たる範囲がありません${scopes ? ` (${scopes})` : ''}`,
          });
          continue;
        }
        const missing = unmatchedScopes(template, proxy.numPages);

        // ファイルごとにずれを測る。同じ発行元でも回によって位置が動くことがあるため。
        const alignment = await estimateTemplateAlignment(template, proxy, settings.templateAutoAlign);
        // オフのときや基準画像がないときは、行ごとに出しても情報が増えないので黙っておく
        // (どちらなのかはテンプレートを選んだところに出している)
        patchJob(job.id, {
          align: alignment.reason === 'disabled' || alignment.reason === 'noAnchor'
            ? undefined
            : alignSummary(alignment),
        });
        const output = await redactToPdf({
          bytes,
          proxy,
          rectsForPage: (pageIndex, pageCount) =>
            rectsForPage(template, pageIndex, pageCount).map((rect) => alignRect(rect, alignment)),
          options: {
            dpi: settings.redactDpi,
            format: settings.redactFormat,
            jpegQuality: settings.jpegQuality,
          },
          onProgress: ({ pageIndex, pageCount }) => setPageProgress({ done: pageIndex, total: pageCount }),
          signal: controller.signal,
        });
        patchJob(job.id, {
          status: 'done',
          output,
          outputName: `${baseName(job.file.name)}${settings.redactSuffix}.pdf`,
          message:
            formatBytes(output.byteLength) +
            (missing.length > 0
              ? ` ・ 当たらない指定あり (${missing.map(scopeLabel).join('・')})`
              : ''),
          condition,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          patchJob(job.id, { status: 'waiting', message: '中止しました' });
          break;
        }
        patchJob(job.id, {
          status: 'error',
          message: error instanceof Error ? error.message : '処理に失敗しました',
        });
      } finally {
        await closePdf(proxy);
      }
    }

    setPageProgress(null);
    setRunning(false);
    abortRef.current = null;

    if (controller.signal.aborted) return;
    // 全部失敗しても「終わりました」と出ていたので、件数で伝える
    setJobs((current) => {
      const done = current.filter((job) => job.status === 'done').length;
      const failed = current.filter((job) => job.status === 'error').length;
      const rest = current.length - done - failed;
      const summary = `完了 ${done}件 / 失敗 ${failed}件${rest > 0 ? ` / 未処理 ${rest}件` : ''}`;
      if (failed > 0 && done === 0) snackbar.error(summary);
      else if (failed > 0) snackbar.show(summary);
      else snackbar.success(summary);
      return current;
    });
  }, [template, jobs, settings, patchJob, snackbar, condition]);

  // 画面ごと閉じられたら処理を止める (裏で走り続けないように)
  useEffect(() => () => abortRef.current?.abort(), []);

  const completed = jobs.filter((job) => job.status === 'done');
  // 処理中と、まだ保存していない出来上がりがあるあいだは引き止める
  useUnloadGuard(running || completed.length > 0);
  const previewJob = jobs.find((job) => job.id === previewJobId);

  const downloadAllAsZip = useCallback(() => {
    if (completed.length === 0) return;
    const entries: Record<string, Uint8Array> = {};
    for (const job of completed) {
      if (!job.output) continue;
      let name = sanitizeFileName(job.outputName ?? `${baseName(job.file.name)}.pdf`);
      // 同名のファイルが混ざっても上書きされないようにする
      let suffix = 1;
      while (entries[name]) {
        name = sanitizeFileName(`${baseName(job.outputName ?? job.file.name)}_${suffix}.pdf`);
        suffix += 1;
      }
      entries[name] = job.output;
    }
    // PDFは既に圧縮済みなので再圧縮せず格納だけする (level 0)
    const zipped = zipSync(entries, { level: 0 });
    saveBytes(zipped, `tamani-pdf_redacted_${completed.length}files.zip`, 'application/zip');
  }, [completed]);

  return (
    <div className="page">
      {jobs.length > 0 ? (
        <AppBarSlot>
          <AppBarAction
            icon="delete"
            label="クリア"
            description="選んだPDFの一覧を空にする"
            danger
            disabled={running}
            onClick={() => {
              setJobs([]);
              snackbar.show('一覧を空にしました。');
            }}
          />
        </AppBarSlot>
      ) : null}

      <header className="page__header">
        <h1 className="page__title">
          <Icon name="layers" size={24} />
          一括墨消し
        </h1>
        <p className="page__lead">
          保存しておいたテンプレートを使って、同じ書式の複数のPDFをまとめて墨消しします。
        </p>
      </header>

      {templates.length === 0 ? (
        <EmptyState icon="layers" title="テンプレートがまだありません">
          先に <a href={hrefFor('redact')}>墨消し</a> で範囲を指定し、テンプレートとして保存してください。
        </EmptyState>
      ) : (
        <>
          <section className="section">
            <h2 className="section__title">1. テンプレートを選ぶ</h2>
            <div className="field">
              <select
                className="select"
                value={templateId}
                disabled={running}
                onChange={(event) => setTemplateId(event.target.value)}
                aria-label="適用するテンプレート"
              >
                <option value="">選択してください</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.rects.length}個の範囲)
                  </option>
                ))}
              </select>
              {template ? (
                <span className="field__hint">
                  {template.rects.length}個の範囲を適用します
                  {template.sourcePageCount ? ` (作成時のページ数: ${template.sourcePageCount})` : ''}
                  <br />
                  {template.anchor && settings.templateAutoAlign
                    ? '自動位置合わせ: オン — ファイルごとにずれを測って範囲を合わせます'
                    : template.anchor
                      ? '自動位置合わせ: 設定でオフ中 — 保存した座標のとおりに当てます'
                      : '自動位置合わせ: このテンプレートは座標だけで保存されています (設定でオンにしてから保存し直すと使えます)'}
                </span>
              ) : null}
            </div>
          </section>

          <section className="section">
            <h2 className="section__title">2. PDFを選ぶ</h2>
            <FileDrop
              accept="application/pdf"
              multiple
              disabled={running}
              title="PDFをドラッグ&ドロップ、またはタップして選択"
              hint="複数選択できます。書式が同じPDFを選んでください。"
              onFiles={addFiles}
            />

            {jobs.length > 0 ? (
              <div className="batch-list" style={{ marginTop: 12 }}>
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className={`batch-item${job.status === 'done' ? ' batch-item--done' : ''}${
                      job.status === 'error' ? ' batch-item--error' : ''
                    }`}
                  >
                    <Icon
                      name={job.status === 'done' ? 'check' : job.status === 'error' ? 'error' : 'pages'}
                      size={18}
                    />
                    <span className="batch-item__name" title={job.file.name}>
                      {job.file.name}
                    </span>
                    <span className="batch-item__status">
                      {job.status === 'running'
                        ? '処理中…'
                        : job.status === 'done'
                          ? `完了 ${job.message ?? ''}${job.align ? ` ・ ${job.align}` : ''}`
                          : job.status === 'error'
                            ? (job.message ?? '失敗')
                            : (job.message ?? '待機中')}
                    </span>
                    {job.status === 'done' && job.output ? (
                      <IconButton
                        icon="download"
                        label={`${job.outputName} を保存`}
                        small
                        onClick={() => saveBytes(job.output!, job.outputName!)}
                      />
                    ) : null}
                    <IconButton
                      icon="close"
                      label="一覧から外す"
                      small
                      disabled={running}
                      onClick={() => removeJob(job.id)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {template && jobs.length > 0 ? (
            <section className="section">
              <h2 className="section__title">3. 当たり位置を確かめる</h2>
              <div className="card card--outlined">
                <p className="text-small muted">
                  書式が少しでも違うと、隠したい場所からずれます。
                  まとめて処理する前に、代表として1つ開いて位置を確かめてください。
                </p>
                <div className="row" style={{ marginTop: 10 }}>
                  <Button
                    variant="tonal"
                    icon="visibility"
                    disabled={running}
                    onClick={() => setPreviewJobId(jobs[0].id)}
                  >
                    1件目でプレビュー
                  </Button>
                  {jobs.length > 1 ? (
                    <select
                      className="select"
                      style={{ width: 'auto', minWidth: 180 }}
                      aria-label="プレビューするファイル"
                      value=""
                      disabled={running}
                      onChange={(event) => {
                        if (event.target.value) setPreviewJobId(event.target.value);
                      }}
                    >
                      <option value="">別のファイルで見る…</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.file.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className="section">
            <h2 className="section__title">{template && jobs.length > 0 ? '4' : '3'}. 実行する</h2>
            {running && pageProgress ? (
              <div className="stack" style={{ marginBottom: 12 }}>
                <ProgressBar value={pageProgress.done} max={pageProgress.total} />
                <span className="text-small muted">
                  {pageProgress.done} / {pageProgress.total} ページ
                </span>
              </div>
            ) : null}

            <div className="row">
              <Button
                variant="filled"
                icon="play"
                disabled={!template || jobs.length === 0 || running}
                onClick={run}
              >
                一括で墨消しする
              </Button>
              {running ? (
                <Button variant="danger" icon="stop" onClick={() => abortRef.current?.abort()}>
                  中止
                </Button>
              ) : null}
              <span className="spacer" />
              <Button
                variant="tonal"
                icon="folder_zip"
                disabled={completed.length === 0 || running}
                onClick={downloadAllAsZip}
              >
                まとめてZIPで保存 ({completed.length})
              </Button>
            </div>
          </section>
        </>
      )}

      <Dialog
        open={previewJob !== undefined && template !== undefined}
        title="テンプレートの当たり位置"
        onClose={() => setPreviewJobId(null)}
        actions={<Button onClick={() => setPreviewJobId(null)}>閉じる</Button>}
      >
        {previewJob && template ? (
          <TemplatePreview
            file={previewJob.file}
            template={template}
            autoAlign={settings.templateAutoAlign}
          />
        ) : null}
      </Dialog>

      <div style={{ marginTop: 16 }}>
        <Banner tone="warning">
          {template?.anchor && settings.templateAutoAlign
            ? '自動位置合わせはPDFどうしの見た目を比べて、ずれを推定する仕組みです。書式が違うPDFや、似た配置が見つからないPDFでは補正されません。'
            : 'テンプレートは座標で範囲を指定しています。書式がずれているPDFでは、隠したい部分から範囲がずれることがあります。'}
          出力されたPDFは必ず目で確認してください。
        </Banner>
      </div>
    </div>
  );
}
