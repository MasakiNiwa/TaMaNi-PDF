import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { AppBarSlot } from '../../app/AppBarSlot';
import { useSettings } from '../../app/SettingsContext';
import { useUnloadGuard } from '../../app/useUnloadGuard';
import { buildPdfFromPages } from '../../core/pdf/assemble';
import { PdfUserError } from '../../core/pdf/errors';
import {
  DEFAULT_PAGE_NUMBER,
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITION_LABEL,
  formatPageNumber,
  type PageNumberFormat,
  type PageNumberOptions,
  type PageNumberPosition,
} from '../../core/pdf/pageNumber';
import { closePdf } from '../../core/pdf/pdfjs';
import type { PageRef } from '../../core/pdf/types';
import { createBlankSource, loadAnyFile } from '../../core/pdf/source';
import { createLimiter } from '../../core/util/queue';
import {
  THUMBNAIL_SIZES,
  THUMBNAIL_SIZE_LABEL,
  THUMBNAIL_WIDTH_PX,
} from '../../core/storage/settings';
import { saveBytes } from '../../core/util/download';
import { baseName, formatBytes } from '../../core/util/format';
import { AppBarAction } from '../../ui/AppBarAction';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { Banner, EmptyState, ProgressBar } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';
import { SortablePageCard } from './SortablePageCard';
import { AddPagesDialog, type PendingAdd } from './AddPagesDialog';
import { PagePreview } from '../../ui/PagePreview';
import { usePageDeck } from './usePageDeck';
import { useWindowedGrid } from './useWindowedGrid';

export function OrganizePage() {
  const deck = usePageDeck();
  const snackbar = useSnackbar();
  const { settings, update: updateSettings } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  /** 読み込み中のファイル数 (写真を何枚も選んだときに、進み具合を見せる) */
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // null のあいだは番号を入れない
  const [pageNumber, setPageNumber] = useState<PageNumberOptions | null>(null);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  /** 拡大表示しているページ (小さくて読めないときの確認用) */
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** 追加するページを選んでもらう順番待ち (ファイルごとに1つ) */
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);

  const previewIndex = deck.pages.findIndex((page) => page.id === previewId);
  const previewPage = previewIndex >= 0 ? deck.pages[previewIndex] : null;
  const previewSource = previewPage ? deck.sources.get(previewPage.sourceId) : undefined;
  // ダイアログの中でいじっている途中の設定 (「入れる」を押すまで反映しない)
  const [draft, setDraft] = useState<PageNumberOptions>(DEFAULT_PAGE_NUMBER);

  const boxWidth = THUMBNAIL_WIDTH_PX[settings.thumbnailSize];

  /**
   * サムネイルの大きさを、この画面のまま変える。
   *
   * 中身を確かめたいときに設定画面まで往復するのは手間なので、
   * ツールバーから1段ずつ動かせるようにする (変えた大きさは設定として残る)。
   */
  const stepThumbnail = useCallback(
    (direction: 1 | -1) => {
      const at = THUMBNAIL_SIZES.indexOf(settings.thumbnailSize);
      const next = THUMBNAIL_SIZES[Math.min(THUMBNAIL_SIZES.length - 1, Math.max(0, at + direction))];
      if (next !== settings.thumbnailSize) updateSettings({ thumbnailSize: next });
    },
    [settings.thumbnailSize, updateSettings],
  );

  // ページ数が多いときは、見えている行だけを描く
  const gridRef = useRef<HTMLDivElement>(null);
  const windowed = useWindowedGrid(gridRef, { total: deck.pages.length });

  const sensors = useSensors(
    // 少し動かしてからドラッグ開始。ボタンのタップを誤ってドラッグにしないため。
    // つまみは専用の当たり判定を持っていてスクロールと取り合わないので、
    // タッチでも待ち時間を置かず、なぞればすぐ動くようにしている。
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const firstSourceName = useMemo(() => {
    const first = deck.pages[0];
    return first ? deck.sources.get(first.sourceId)?.name : undefined;
  }, [deck.pages, deck.sources]);

  const handleError = useCallback(
    (error: unknown) => {
      const message =
        error instanceof PdfUserError
          ? error.message
          : error instanceof Error
            ? error.message
            : '処理に失敗しました。';
      snackbar.error(message);
    },
    [snackbar],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setLoading({ done: 0, total: files.length });
      try {
        // 最初の読み込みは全ページ入れる。選ばせるのは「あとから足す」ときだけ。
        let hasPages = deck.pages.length > 0;
        let added = 0;
        const failed: string[] = [];

        /*
         * 読み込みは何枚かまとめて進める。
         * 写真やスクリーンショットを10枚ほど選ぶことがあり、1枚ずつ順番に待つと
         * そのぶん待ち時間が積み上がるため。同時に走らせすぎると端末が苦しいので数を絞る。
         * 結果は選んだ順に並べ直してから入れるので、並び順は変わらない。
         */
        const load = createLimiter(3);
        const results = await Promise.all(
          files.map((file) =>
            load(async () => {
              try {
                return { ok: true as const, file, loaded: await loadAnyFile(file, settings.imageImport) };
              } catch (error) {
                return { ok: false as const, file, error };
              } finally {
                setLoading((current) => (current ? { ...current, done: current.done + 1 } : current));
              }
            }),
          ),
        );

        for (const result of results) {
          // 1件ずつその場で片付ける。まとめて最後に反映すると、
          // 途中で読めないファイルがあったときに、先に読めたぶんまで消えてしまう。
          if (!result.ok) {
            failed.push(result.file.name);
            handleError(result.error);
            continue;
          }
          const { source, pages } = result.loaded;
          const choose = settings.addPagesMode === 'choose' && hasPages && pages.length > 1;
          if (choose) {
            setPendingAdds((current) => [...current, { source, pages }]);
          } else {
            deck.addSource(source, pages);
            added += 1;
          }
          hasPages = true;
        }

        if (added > 0) snackbar.success(`${added}件のファイルを読み込みました。`);
        if (failed.length > 0 && added === 0 && files.length > failed.length) {
          snackbar.error(`${failed.join('、')} は読み込めませんでした。`);
        }
      } finally {
        setLoading(null);
        setBusy(false);
      }
    },
    [deck, handleError, snackbar, settings.addPagesMode, settings.imageImport],
  );

  /** 順番待ちの先頭を片付ける (追加する / 追加せず閉じる) */
  const resolvePendingAdd = useCallback(
    (pages: PageRef[] | null) => {
      setPendingAdds((current) => {
        const [entry, ...rest] = current;
        if (!entry) return current;
        if (pages && pages.length > 0) {
          deck.addSource(entry.source, pages);
        } else {
          // 入れないファイルは開いたままにしない
          void closePdf(entry.source.proxy);
        }
        return rest;
      });
    },
    [deck],
  );

  const addBlankPage = useCallback(async () => {
    setBusy(true);
    try {
      const { source, pages } = await createBlankSource();
      deck.addSource(source, pages);
      snackbar.show('空白ページを追加しました。');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [deck, handleError, snackbar]);

  const toggleSelect = useCallback((id: string, isSelected: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(deck.pages.map((page) => page.id)));
  }, [deck.pages]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        deck.reorder(String(active.id), String(over.id));
      }
    },
    [deck],
  );

  const deleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    deck.deletePages(selected);
    clearSelection();
  }, [deck, selected, clearSelection]);

  /** 選んだページだけを残す (いらないページを1枚ずつ消さずに済むように) */
  const keepSelected = useCallback(() => {
    if (selected.size === 0 || selected.size === deck.pages.length) return;
    const removed = deck.pages.length - selected.size;
    deck.keepOnly(selected);
    clearSelection();
    snackbar.show(`${removed}ページを削除しました。戻すで元に戻せます。`);
  }, [deck, selected, clearSelection, snackbar]);

  const exportPdf = useCallback(async () => {
    if (deck.pages.length === 0) return;
    setBusy(true);
    try {
      const bytes = await buildPdfFromPages(deck.sources, deck.pages, pageNumber);
      const name = `${baseName(firstSourceName ?? 'document')}${settings.organizeSuffix}.pdf`;
      saveBytes(bytes, name);
      setSavedPages(deck.pages);
      snackbar.success(`${deck.pages.length}ページのPDFを書き出しました。`);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [deck.pages, deck.sources, firstSourceName, settings.organizeSuffix, snackbar, handleError, pageNumber]);

  const hasPages = deck.pages.length > 0;
  /**
   * 書き出したときの並び。
   *
   * 書き出したあとも引き止めると「保存したのにまだ何かあるのか」と迷わせるので、
   * 書き出してから変えていないあいだは引き止めない。
   * 並びは変更のたびに新しい配列になるので、同じものかどうかで見分けられる。
   */
  const [savedPages, setSavedPages] = useState<PageRef[] | null>(null);
  useUnloadGuard(hasPages && deck.pages !== savedPages);
  const numberedCount = Math.max(0, deck.pages.length - (draft.skipFirst ? 1 : 0));
  const lastNumber = draft.startAt + Math.max(0, numberedCount - 1);
  // 選択なしで全ページに効くのは意外なので、回転ボタンの手前に対象を出す。
  // ボタンの文字に混ぜるとスマホで折り返しが増えるため、ひとつの札にまとめる。
  const rotateTarget = selected.size > 0 ? `選択した${selected.size}ページ` : '全ページ';
  const totalBytes = useMemo(
    () => [...deck.sources.values()].reduce((sum, source) => sum + source.byteLength, 0),
    [deck.sources],
  );

  return (
    <div className="page">
      {/*
        ページが無くなっても、戻せる履歴があるあいだはボタンを残す。
        全部消したあとに戻す手立てが無くなるのがいちばん困るため。
      */}
      {hasPages || deck.canUndo || deck.canRedo ? (
        <AppBarSlot>
          <AppBarAction
            icon="undo"
            label="戻す"
            description="元に戻す"
            disabled={!deck.canUndo}
            onClick={deck.undo}
          />
          <AppBarAction icon="redo" label="やり直す" disabled={!deck.canRedo} onClick={deck.redo} />
          <AppBarAction
            icon="delete"
            label="クリア"
            description="読み込んだPDFをすべて破棄する"
            danger
            disabled={deck.sources.size === 0}
            onClick={() => setConfirmClear(true)}
          />
        </AppBarSlot>
      ) : null}

      <header className="page__header">
        <h1 className="page__title">
          <Icon name="pages" size={24} />
          ページ整理
        </h1>
        {/* 読み込んだあとは前置きを畳む。一覧までの距離を短くするため。 */}
        {!hasPages ? (
          <p className="page__lead">
            ページの並べ替え・回転・追加・削除をして、1つのPDFとして書き出します。文字は文字のまま残ります。
          </p>
        ) : null}
      </header>

      <div className="stack" style={{ marginBottom: 20 }}>
        <FileDrop
          accept="application/pdf,image/jpeg,image/png"
          multiple
          disabled={busy}
          icon={hasPages ? 'add' : 'upload'}
          compact={hasPages}
          title={hasPages ? 'PDF・画像を追加する' : 'PDF・画像をドラッグ&ドロップ、またはタップして選択'}
          hint={
            hasPages
              ? undefined
              : 'PDFだけでなく、JPEG・PNGの画像からでも始められます。複数まとめて選べます。'
          }
          onFiles={addFiles}
        />
        {/* 何枚も選んだときに「固まった?」と思わせないよう、進み具合を出す */}
        {loading ? (
          <div className="card card--outlined" role="status">
            <p className="text-small" style={{ marginTop: 0, marginBottom: 8 }}>
              読み込んでいます… {loading.done} / {loading.total} 件
            </p>
            <ProgressBar value={loading.done} max={loading.total} />
          </div>
        ) : null}
      </div>

      {!hasPages ? (
        <EmptyState icon="pages" title="まだページがありません">
          PDFや画像を読み込むとページの一覧が表示されます。
        </EmptyState>
      ) : (
        <>
          <div className="toolbar">
            {/* まとまりごとに囲う。ボタンが増えたときに、何の仲間かを見分けやすくするため。 */}
            <span className="toolbar__group" role="group" aria-label="ページの編集">
              <span className="chip">回転の対象: {rotateTarget}</span>
            <Button
              small
              variant="outlined"
              icon="rotate_left"
              onClick={() => deck.rotatePages(selected.size > 0 ? selected : null, -90)}
            >
              左に回転
            </Button>
            <Button
              small
              variant="outlined"
              icon="rotate_right"
              onClick={() => deck.rotatePages(selected.size > 0 ? selected : null, 90)}
            >
              右に回転
            </Button>
              <Button small variant="outlined" icon="note_add" onClick={addBlankPage} disabled={busy}>
                空白ページ
              </Button>
            <Button
              small
              variant={pageNumber ? 'tonal' : 'outlined'}
              icon="tag"
              onClick={() => {
                setDraft(pageNumber ?? DEFAULT_PAGE_NUMBER);
                setNumberDialogOpen(true);
              }}
            >
              {pageNumber ? `ページ番号: ${PAGE_NUMBER_POSITION_LABEL[pageNumber.position]}` : 'ページ番号'}
            </Button>
            </span>

            <span className="toolbar__group thumb-size" role="group" aria-label="一覧の表示サイズ">
              <IconButton
                icon="zoom_out"
                label="サムネイルを小さく"
                small
                disabled={settings.thumbnailSize === THUMBNAIL_SIZES[0]}
                onClick={() => stepThumbnail(-1)}
              />
              <span className="thumb-size__label">{THUMBNAIL_SIZE_LABEL[settings.thumbnailSize]}</span>
              <IconButton
                icon="zoom_in"
                label="サムネイルを大きく"
                small
                disabled={settings.thumbnailSize === THUMBNAIL_SIZES[THUMBNAIL_SIZES.length - 1]}
                onClick={() => stepThumbnail(1)}
              />
            </span>

            <span className="toolbar__group" role="group" aria-label="選んだページへの操作">
            {selected.size > 0 ? (
              <>
                <Button small variant="outlined" icon="file_copy" onClick={() => deck.duplicatePages(selected)}>
                  複製
                </Button>
                <Button small variant="danger" icon="delete" onClick={deleteSelected}>
                  削除
                </Button>
                <Button
                  small
                  variant="danger"
                  icon="filter_list"
                  disabled={selected.size === deck.pages.length}
                  onClick={keepSelected}
                >
                  選択以外を削除
                </Button>
                <Button small onClick={clearSelection}>
                  選択解除
                </Button>
              </>
            ) : (
              <Button small onClick={selectAll}>
                すべて選択
              </Button>
            )}
            </span>

            {/* 書き出しは上に置く。ページ数が多いと、下まで送るのが手間になるため。 */}
            <span className="spacer" />
            <Button small variant="filled" icon="download" onClick={exportPdf} disabled={busy}>
              PDFを書き出す
            </Button>
          </div>

          <p className="text-small muted" style={{ marginBottom: 12 }}>
            全{deck.pages.length}ページ / 読み込み済み {deck.sources.size}ファイル ({formatBytes(totalBytes)})
            {windowed.active ? ' ・ 表示は画面に入るぶんだけ描いています (操作はすべてのページに効きます)' : ''}
          </p>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={deck.pages.map((page) => page.id)} strategy={rectSortingStrategy}>
              <div
                ref={gridRef}
                className="page-grid"
                style={{
                  ['--page-card-width' as string]: `${boxWidth + 24}px`,
                  // スマホは既定で2列。大きい指定のときだけ1列に落として、実際に大きく見せる。
                  ['--page-card-floor' as string]: boxWidth >= 232 ? '100%' : '46%',
                  // 描いていない行のぶんは余白で埋めて、スクロールの長さを保つ
                  paddingTop: windowed.padTop || undefined,
                  paddingBottom: windowed.padBottom || undefined,
                }}
              >
                {deck.pages.map((page, index) => {
                  if (index < windowed.start || index >= windowed.end) return null;
                  const source = deck.sources.get(page.sourceId);
                  if (!source) return null;
                  return (
                    <SortablePageCard
                      key={page.id}
                      page={page}
                      index={index}
                      total={deck.pages.length}
                      source={source}
                      cache={deck.thumbnails}
                      boxWidth={boxWidth}
                      selected={selected.has(page.id)}
                      onToggleSelect={toggleSelect}
                      onRotate={(id, delta) => deck.rotatePages(new Set([id]), delta)}
                      onDelete={(id) => {
                        deck.deletePages(new Set([id]));
                        toggleSelect(id, false);
                      }}
                      onDuplicate={(id) => deck.duplicatePages(new Set([id]))}
                      onMove={deck.movePage}
                      onOpen={setPreviewId}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

        </>
      )}

      {pendingAdds[0] ? (
        <AddPagesDialog
          // ファイルごとに作り直す。前のファイルで選んだ状態が残ると、
          // 件数の表示と実際に入るページが食い違う。
          key={pendingAdds[0].source.id}
          entry={pendingAdds[0]}
          cache={deck.thumbnails}
          remaining={pendingAdds.length - 1}
          onCancel={() => resolvePendingAdd(null)}
          onAdd={(pages) => {
            if (pages.length === 0) return;
            resolvePendingAdd(pages);
            snackbar.success(`${pages.length}ページを追加しました。`);
          }}
        />
      ) : null}

      {previewPage && previewSource ? (
        <PagePreview
          page={previewPage}
          source={previewSource}
          index={previewIndex}
          total={deck.pages.length}
          selected={selected.has(previewPage.id)}
          onClose={() => setPreviewId(null)}
          onNavigate={(delta) => {
            const next = deck.pages[previewIndex + delta];
            if (next) setPreviewId(next.id);
          }}
          onRotate={(delta) => deck.rotatePages(new Set([previewPage.id]), delta)}
          onDelete={() => {
            // 消したら、その場にきた次のページへ移る (最後なら閉じる)
            const next = deck.pages[previewIndex + 1] ?? deck.pages[previewIndex - 1];
            deck.deletePages(new Set([previewPage.id]));
            toggleSelect(previewPage.id, false);
            setPreviewId(next ? next.id : null);
          }}
          onToggleSelect={() => toggleSelect(previewPage.id, !selected.has(previewPage.id))}
        />
      ) : null}

      <Dialog
        open={numberDialogOpen}
        title="ページ番号"
        onClose={() => setNumberDialogOpen(false)}
        actions={
          <>
            {/* 何も変えずに閉じる道を用意する (「入れない」は設定を消す操作なので別物) */}
            <Button onClick={() => setNumberDialogOpen(false)}>キャンセル</Button>
            <Button
              variant="danger"
              disabled={!pageNumber}
              onClick={() => {
                setPageNumber(null);
                setNumberDialogOpen(false);
                snackbar.show('ページ番号を入れない設定に戻しました。');
              }}
            >
              入れない
            </Button>
            <Button
              variant="filled"
              onClick={() => {
                setPageNumber(draft);
                setNumberDialogOpen(false);
                snackbar.success('書き出すときにページ番号を入れます。');
              }}
            >
              この設定で入れる
            </Button>
          </>
        }
      >
        <p className="text-small muted">
          書き出すPDFに通し番号を入れます。元のページには触れないので、文字は文字のまま残ります。
        </p>

        <div className="stack">
          <div className="field">
            <span className="field__label">位置</span>
            <div className="number-grid" role="group" aria-label="ページ番号の位置">
              {(Object.keys(PAGE_NUMBER_POSITION_LABEL) as PageNumberPosition[]).map((position) => (
                <button
                  key={position}
                  type="button"
                  className={`number-grid__cell${draft.position === position ? ' number-grid__cell--on' : ''}`}
                  aria-pressed={draft.position === position}
                  onClick={() => setDraft({ ...draft, position })}
                >
                  {PAGE_NUMBER_POSITION_LABEL[position]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="number-format">
              書き方
            </label>
            <select
              id="number-format"
              className="select"
              value={draft.format}
              onChange={(event) => setDraft({ ...draft, format: event.target.value as PageNumberFormat })}
            >
              {/* 見本はいま読み込んでいるページ数で作る (1 / 12 のような固定の例だと戸惑うため) */}
              {PAGE_NUMBER_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {formatPageNumber(format, draft.startAt, lastNumber)}
                </option>
              ))}
            </select>
            <span className="field__hint">
              番号はPDFに標準で備わっている欧文フォントで描くため、日本語は入れられません。
            </span>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <label className="field__label" htmlFor="number-start">
                開始番号
              </label>
              <input
                id="number-start"
                className="input"
                type="number"
                min={0}
                max={9999}
                value={draft.startAt}
                onChange={(event) =>
                  setDraft({ ...draft, startAt: Math.max(0, Math.min(9999, Number(event.target.value) || 0)) })
                }
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <label className="field__label" htmlFor="number-size">
                文字の大きさ
              </label>
              <select
                id="number-size"
                className="select"
                value={draft.size}
                onChange={(event) => setDraft({ ...draft, size: Number(event.target.value) })}
              >
                {[8, 10, 12, 14, 18].map((size) => (
                  <option key={size} value={size}>
                    {size} pt
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft.skipFirst}
              onChange={(event) => setDraft({ ...draft, skipFirst: event.target.checked })}
            />
            <span>1ページ目には入れない (表紙など)</span>
          </label>

          <div className="card card--outlined">
            <div className="text-small muted" style={{ marginBottom: 6 }}>
              仕上がりの目安
            </div>
            <div className={`number-preview number-preview--${draft.position}`} aria-hidden="true">
              <span className="number-preview__mark">
                {formatPageNumber(draft.format, draft.startAt, lastNumber)}
              </span>
            </div>
            <div className="text-small muted" style={{ marginTop: 6 }}>
              {numberedCount}ページに番号が入ります ({draft.startAt} 〜 {lastNumber})
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmClear}
        title="クリアしますか?"
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <Button onClick={() => setConfirmClear(false)}>キャンセル</Button>
            <Button
              variant="danger"
              onClick={() => {
                deck.reset();
                clearSelection();
                setConfirmClear(false);
                snackbar.show('読み込んだPDFを閉じました。');
              }}
            >
              クリアする
            </Button>
          </>
        }
      >
        <p style={{ marginBottom: 0 }}>
          読み込んだ{deck.sources.size}件のファイルと、編集中の{deck.pages.length}ページを破棄して最初の状態に戻ります。
        </p>
      </Dialog>

      <div style={{ marginTop: 24 }}>
        <Banner tone="info">
          各ページの右上にある <Icon name="drag_indicator" size={14} /> のつまみをドラッグすると並べ替えられます。
          チェックを付けると、複数ページをまとめて回転・複製・削除できます。
        </Banner>
      </div>

    </div>
  );
}
