import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppBarSlot } from '../../app/AppBarSlot';
import { hrefFor } from '../../app/routes';
import { useSettings } from '../../app/SettingsContext';
import { useUnloadGuard } from '../../app/useUnloadGuard';
import {
  COMPRESS_LEVELS,
  compressPdf,
  compressToTarget,
  looksTextHeavy,
  type CompressLevel,
  type CompressLevelId,
  type CompressProgress,
} from '../../core/pdf/compress';
import { PdfUserError } from '../../core/pdf/errors';
import { closePdf, openWithPdfjs, type PDFDocumentProxy } from '../../core/pdf/pdfjs';
import { ThumbnailCache } from '../../core/pdf/render';
import type { PageRef, PdfSource } from '../../core/pdf/types';
import { saveBytes } from '../../core/util/download';
import { baseName, formatBytes } from '../../core/util/format';
import { createId } from '../../core/util/id';
import { AppBarAction } from '../../ui/AppBarAction';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { PagePreview } from '../../ui/PagePreview';
import { PageThumbnail } from '../../ui/PageThumbnail';
import { Banner, EmptyState, ProgressBar, Segmented } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';

/**
 * PDFのファイルサイズを小さくする画面。
 *
 * いちばん多い困りごとは「申請システムの上限に引っかかって出せない」なので、
 * 既定は "収めたい大きさを言う" ほうにしている。画質を自分で決めたい人のために
 * 強さを選ぶ道も用意しているが、たいていの人は数字を選ぶだけで終わる。
 *
 * 圧縮は中身を画像に刷り直すことなので、失うもの (文字の検索・選択) は必ず伝え、
 * 小さくならなかったときは、そう言って保存を勧めない。
 */

/** 目安サイズの候補 (よくある上限) */
const TARGET_CHOICES = [1, 2, 3, 5, 10] as const;

interface Loaded {
  name: string;
  bytes: Uint8Array;
  size: number;
  pageCount: number;
  source: PdfSource;
}

interface Result {
  bytes: Uint8Array;
  level: CompressLevel;
  reached: boolean;
  /** 「大きさで決める」で作ったときの目安 (MB)。画質で決めたときは null */
  targetMb: number | null;
  source: PdfSource;
  saved: boolean;
}

function toSource(name: string, bytes: Uint8Array, proxy: PDFDocumentProxy): PdfSource {
  return {
    id: createId('src'),
    kind: 'pdf',
    name,
    bytes,
    pageCount: proxy.numPages,
    proxy,
    byteLength: bytes.byteLength,
  };
}

function firstPage(source: PdfSource): PageRef {
  return { id: `${source.id}:0`, sourceId: source.id, sourceIndex: 0, rotation: 0 };
}

export function CompressPage() {
  const snackbar = useSnackbar();
  const { settings } = useSettings();

  const [pdf, setPdf] = useState<Loaded | null>(null);
  const [textHeavy, setTextHeavy] = useState(false);
  const [mode, setMode] = useState<'target' | 'level'>('target');
  const [targetMb, setTargetMb] = useState<number>(3);
  const [levelId, setLevelId] = useState<CompressLevelId>('standard');
  const [progress, setProgress] = useState<CompressProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [zoom, setZoom] = useState<'before' | 'after' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const cache = useMemo(() => new ThumbnailCache(40), []);

  // 書き出していない結果があるあいだは、閉じようとしたときに引き止める
  useUnloadGuard(result !== null && !result.saved);

  /*
   * 開いているPDFの後始末は、状態の更新関数の外で行う。
   * 更新関数の中で閉じると、React が更新を二度実行する場面 (開発時の厳密モードなど) で
   * 同じドキュメントを二度閉じてしまうため。
   */
  const pdfRef = useRef<Loaded | null>(null);
  pdfRef.current = pdf;
  const resultRef = useRef<Result | null>(null);
  resultRef.current = result;

  useEffect(
    () => () => {
      void closePdf(pdfRef.current?.source.proxy);
      void closePdf(resultRef.current?.source.proxy);
      cache.clear();
      abortRef.current?.abort();
    },
    [cache],
  );

  /** いまの結果を閉じて、必要なら新しい結果に差し替える */
  const replaceResult = useCallback(
    (next: Result | null) => {
      const current = resultRef.current;
      resultRef.current = next;
      setResult(next);
      if (current) {
        cache.dropSource(current.source.id);
        void closePdf(current.source.proxy);
      }
    },
    [cache],
  );

  const loadFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const proxy = await openWithPdfjs(bytes);
        const source = toSource(file.name, bytes, proxy);
        const previous = pdfRef.current;
        const next = { name: file.name, bytes, size: bytes.byteLength, pageCount: proxy.numPages, source };
        pdfRef.current = next;
        setPdf(next);
        replaceResult(null);
        if (previous) {
          cache.dropSource(previous.source.id);
          void closePdf(previous.source.proxy);
        }
        // 文字の多いPDFは、画像にすると失うものが大きい。先に確かめて伝える。
        setTextHeavy(await looksTextHeavy(proxy).catch(() => false));
      } catch (error) {
        const message =
          error instanceof PdfUserError ? error.message : `「${file.name}」を読み込めませんでした。`;
        snackbar.error(message);
      }
    },
    [snackbar, replaceResult, cache],
  );

  const clearAll = useCallback(() => {
    const current = pdfRef.current;
    pdfRef.current = null;
    setPdf(null);
    replaceResult(null);
    if (current) {
      cache.dropSource(current.source.id);
      void closePdf(current.source.proxy);
    }
    setTextHeavy(false);
    setConfirmClear(false);
    snackbar.show('読み込んだPDFを閉じました。');
  }, [snackbar, replaceResult, cache]);

  const run = useCallback(async () => {
    if (!pdf) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ attempt: 1, attempts: 1, pageIndex: 0, pageCount: pdf.pageCount });
    try {
      const level = COMPRESS_LEVELS.find((item) => item.id === levelId) ?? COMPRESS_LEVELS[1];
      const outcome =
        mode === 'target'
          ? await compressToTarget({
              bytes: pdf.bytes,
              proxy: pdf.source.proxy,
              targetBytes: Math.round(targetMb * 1024 * 1024),
              onProgress: setProgress,
              signal: controller.signal,
            })
          : {
              bytes: await compressPdf({
                bytes: pdf.bytes,
                proxy: pdf.source.proxy,
                level,
                onProgress: setProgress,
                signal: controller.signal,
              }),
              level,
              reached: true,
            };

      // 仕上がりを見比べられるよう、結果も開いておく
      const proxy = await openWithPdfjs(outcome.bytes);
      replaceResult({
        bytes: outcome.bytes,
        level: outcome.level,
        reached: outcome.reached,
        targetMb: mode === 'target' ? targetMb : null,
        source: toSource(`${baseName(pdf.name)}${settings.compressSuffix}.pdf`, outcome.bytes, proxy),
        saved: false,
      });

      if (outcome.bytes.byteLength >= pdf.size) {
        // 小さくなっていないのに「できました」と言わない
        snackbar.error('このPDFは小さくなりませんでした。もとのPDFをそのままお使いください。');
      } else if (!outcome.reached) {
        snackbar.show('いちばん強い設定まで試しましたが、目安のサイズには届きませんでした。');
      } else {
        snackbar.success('圧縮しました。仕上がりを確かめてから保存してください。');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        snackbar.show('圧縮を中止しました。');
      } else {
        snackbar.error(error instanceof Error ? error.message : '圧縮に失敗しました。');
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }, [pdf, mode, targetMb, levelId, settings.compressSuffix, snackbar, replaceResult]);

  const save = useCallback(() => {
    if (!pdf || !result) return;
    saveBytes(result.bytes, `${baseName(pdf.name)}${settings.compressSuffix}.pdf`);
    setResult({ ...result, saved: true });
    snackbar.success('圧縮したPDFを書き出しました。');
  }, [pdf, result, settings.compressSuffix, snackbar]);

  const shrink = useMemo(() => {
    if (!pdf || !result) return null;
    const after = result.bytes.byteLength;
    return { after, percent: Math.round((1 - after / pdf.size) * 100) };
  }, [pdf, result]);

  const zoomSource = zoom === 'after' ? result?.source : zoom === 'before' ? pdf?.source : undefined;

  return (
    <div className="page">
      {pdf ? (
        <AppBarSlot>
          <AppBarAction
            icon="delete"
            label="クリア"
            description="読み込んだPDFを閉じる"
            danger
            onClick={() => setConfirmClear(true)}
          />
        </AppBarSlot>
      ) : null}

      <header className="page__header">
        <h1 className="page__title">
          <Icon name="compress" size={24} />
          サイズ圧縮
        </h1>
        {!pdf ? (
          <p className="page__lead">
            写真やスキャンでできた大きなPDFを、読める品質のまま軽くします。
            「システムの上限に引っかかって出せない」ときに。
          </p>
        ) : null}
      </header>

      <div className="stack" style={{ marginBottom: 20 }}>
        <FileDrop
          accept="application/pdf"
          icon={pdf ? 'refresh' : 'upload'}
          compact={Boolean(pdf)}
          title={pdf ? '別のPDFに切り替える' : 'PDFをドラッグ&ドロップ、またはタップして選択'}
          hint={pdf ? `現在: ${pdf.name} (${formatBytes(pdf.size)} ・ ${pdf.pageCount}ページ)` : '1つのPDFを読み込んで圧縮します。'}
          onFiles={loadFile}
        />
      </div>

      {!pdf ? (
        <>
          <EmptyState icon="compress" title="PDFを読み込んでください">
            読み込んだPDFはこの端末の中だけで処理されます。
          </EmptyState>
          <div className="stack" style={{ marginTop: 20 }}>
            <Banner tone="warning">
              圧縮すると、中身は<strong>画像として刷り直され</strong>ます。文字検索・テキスト選択・しおり・注釈は失われます。
              文字だけのPDFはもともと小さいので、この機能の出番は写真やスキャンのPDFです。
            </Banner>
          </div>
        </>
      ) : (
        <div className="stack">
          {textHeavy ? (
            <Banner tone="warning">
              このPDFには<strong>文字のデータが多く含まれています</strong>。
              圧縮すると文字は画像になり、検索やコピーができなくなります。
              また、もともと文字中心のPDFは小さくならないことがあります。
            </Banner>
          ) : null}

          <div className="card card--outlined">
            <h2 className="section__title" style={{ marginTop: 0 }}>
              どうやって小さくしますか
            </h2>
            <Segmented
              ariaLabel="圧縮のしかた"
              value={mode}
              options={[
                { value: 'target', label: '大きさで決める' },
                { value: 'level', label: '画質で決める' },
              ]}
              onChange={(next) => setMode(next)}
            />

            {mode === 'target' ? (
              <div style={{ marginTop: 16 }}>
                <p className="text-small muted" style={{ marginTop: 0 }}>
                  収めたい大きさを選びます。届くまで画質を一段ずつ落として試します。
                </p>
                <div className="row" role="group" aria-label="目安のサイズ">
                  {TARGET_CHOICES.map((mb) => (
                    <Button
                      key={mb}
                      small
                      variant={targetMb === mb ? 'filled' : 'outlined'}
                      aria-pressed={targetMb === mb}
                      onClick={() => setTargetMb(mb)}
                    >
                      {mb}MB以下
                    </Button>
                  ))}
                </div>
                {/* もう上限を下回っているのに圧縮させるのは、失うだけで得がない */}
                {pdf.size <= targetMb * 1024 * 1024 ? (
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="info">
                      このPDFは<strong>すでに{targetMb}MB以下</strong> ({formatBytes(pdf.size)}) です。
                      そのまま出せるなら、圧縮しないほうが文字を残せます。
                    </Banner>
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <p className="text-small muted" style={{ marginTop: 0 }}>
                  強さを選びます。下にいくほど小さく、粗くなります。
                </p>
                <div className="stack">
                  {COMPRESS_LEVELS.map((level) => (
                    <label key={level.id} className={`choice${levelId === level.id ? ' choice--on' : ''}`}>
                      <input
                        type="radio"
                        name="compress-level"
                        value={level.id}
                        checked={levelId === level.id}
                        onChange={() => setLevelId(level.id)}
                      />
                      <span>
                        <span className="choice__title">{level.label}</span>
                        <span className="choice__desc">
                          {level.hint} ({level.dpi}dpi ・ 画質{Math.round(level.quality * 100)}%)
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="row" style={{ marginTop: 16 }}>
              <Button variant="filled" icon="compress" onClick={() => void run()} disabled={progress !== null}>
                圧縮する
              </Button>
            </div>
          </div>

          {result && shrink ? (
            <div className="card card--outlined">
              <h2 className="section__title" style={{ marginTop: 0 }}>
                仕上がり
              </h2>

              <p className="compress-size">
                {formatBytes(pdf.size)}
                <Icon name="arrow_forward" size={20} />
                <strong>{formatBytes(shrink.after)}</strong>
                {shrink.percent > 0 ? <span className="compress-size__badge">−{shrink.percent}%</span> : null}
              </p>
              <p className="text-small muted">
                {result.level.label} ({result.level.dpi}dpi ・ 画質{Math.round(result.level.quality * 100)}%) で作りました。
              </p>

              {shrink.after >= pdf.size ? (
                <Banner tone="error">
                  <strong>小さくなりませんでした。</strong>
                  もとのPDFのほうが小さいので、保存せずにそのままお使いください。
                  文字中心のPDFや、すでに十分圧縮されたPDFではこうなります。
                </Banner>
              ) : !result.reached ? (
                <Banner tone="warning">
                  いちばん強い設定まで試しましたが、{result.targetMb}MBには届きませんでした。
                  ページ数が多いPDFは、<a href={hrefFor('organize')}>ページ整理</a> で分けてから圧縮すると通せることがあります。
                </Banner>
              ) : null}

              {/* 粗くなりすぎていないか、その場で見比べられるようにする */}
              <div className="compare-grid">
                {[
                  { key: 'before' as const, label: `元 (${formatBytes(pdf.size)})`, source: pdf.source },
                  { key: 'after' as const, label: `圧縮後 (${formatBytes(shrink.after)})`, source: result.source },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="compare-grid__item"
                    onClick={() => setZoom(item.key)}
                  >
                    <span className="compare-grid__label">
                      {item.label}
                      <Icon name="zoom_in" size={16} />
                    </span>
                    <PageThumbnail
                      cache={cache}
                      source={item.source}
                      pageIndex={0}
                      boxWidth={200}
                      alt={`${item.label} の1ページ目`}
                    />
                  </button>
                ))}
              </div>
              <p className="text-small muted">押すと1ページ目を大きく見られます。</p>

              <div className="row" style={{ marginTop: 12 }}>
                <Button variant="filled" icon="download" onClick={save}>
                  保存する
                </Button>
              </div>
            </div>
          ) : null}

          <Banner tone="warning">
            圧縮すると、中身は<strong>画像として刷り直され</strong>ます。文字検索・テキスト選択・しおり・注釈は失われます。
          </Banner>
        </div>
      )}

      {zoom && zoomSource ? (
        <PagePreview
          page={firstPage(zoomSource)}
          source={zoomSource}
          index={0}
          total={1}
          selected={false}
          onClose={() => setZoom(null)}
          onNavigate={() => undefined}
        />
      ) : null}

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
          読み込んだPDFと圧縮の結果を破棄して、最初の画面に戻ります。
          {result && !result.saved ? ' まだ保存していない結果は消えます。' : ''}
        </p>
      </Dialog>

      <Dialog
        open={progress !== null}
        title="圧縮しています"
        persistent
        onClose={() => undefined}
        actions={
          <Button variant="danger" icon="stop" onClick={() => abortRef.current?.abort()}>
            中止
          </Button>
        }
      >
        <p className="text-small">
          {progress ? `${progress.pageIndex} / ${progress.pageCount} ページ` : ''}
          {progress && progress.attempt > 1 ? ` (${progress.attempt}回目の試し)` : ''}
        </p>
        <ProgressBar value={progress?.pageIndex} max={progress?.pageCount} />
        <p className="text-small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          目安のサイズに収めるときは、届くまで何回か作り直します。この間もファイルは端末の外に出ません。
        </p>
      </Dialog>
    </div>
  );
}
