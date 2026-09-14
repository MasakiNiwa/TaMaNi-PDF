import { useCallback, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { AppBarSlot } from '../../app/AppBarSlot';
import { useSettings } from '../../app/SettingsContext';
import { useTemplates } from '../../app/TemplatesContext';
import { hrefFor } from '../../app/routes';
import { redactToPdf } from '../../core/pdf/redact';
import { rectsForPage } from '../../core/storage/templates';
import { saveBytes } from '../../core/util/download';
import { baseName, formatBytes, sanitizeFileName } from '../../core/util/format';
import { createId } from '../../core/util/id';
import { AppBarAction } from '../../ui/AppBarAction';
import { Button, IconButton } from '../../ui/Button';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { Banner, EmptyState, ProgressBar } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';

type JobStatus = 'waiting' | 'running' | 'done' | 'error';

interface Job {
  id: string;
  file: File;
  status: JobStatus;
  message?: string;
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
  const abortRef = useRef<AbortController | null>(null);

  const template = useMemo(
    () => templates.find((item) => item.id === templateId),
    [templates, templateId],
  );

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
      try {
        const bytes = new Uint8Array(await job.file.arrayBuffer());
        const output = await redactToPdf({
          bytes,
          rectsForPage: (pageIndex, pageCount) => rectsForPage(template, pageIndex, pageCount),
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
          message: formatBytes(output.byteLength),
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
      }
    }

    setPageProgress(null);
    setRunning(false);
    abortRef.current = null;
    if (!controller.signal.aborted) snackbar.success('一括墨消しが終わりました。');
  }, [template, jobs, settings, patchJob, snackbar]);

  const completed = jobs.filter((job) => job.status === 'done');

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
                          ? `完了 ${job.message ?? ''}`
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

          <section className="section">
            <h2 className="section__title">3. 実行する</h2>
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

      <div style={{ marginTop: 16 }}>
        <Banner tone="warning">
          テンプレートは座標で範囲を指定しています。書式がずれているPDFでは隠したい部分からずれることがあるので、
          出力されたPDFを必ず目で確認してください。
        </Banner>
      </div>
    </div>
  );
}
