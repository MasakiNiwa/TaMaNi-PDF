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
import { createBlankSource, loadAnyFile } from '../../core/pdf/source';
import { THUMBNAIL_WIDTH_PX } from '../../core/storage/settings';
import { saveBytes } from '../../core/util/download';
import { baseName, formatBytes } from '../../core/util/format';
import { AppBarAction } from '../../ui/AppBarAction';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { FileDrop } from '../../ui/FileDrop';
import { Icon } from '../../ui/Icon';
import { Banner, EmptyState } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';
import { SortablePageCard } from './SortablePageCard';
import { usePageDeck } from './usePageDeck';
import { useWindowedGrid } from './useWindowedGrid';

export function OrganizePage() {
  const deck = usePageDeck();
  const snackbar = useSnackbar();
  const { settings } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // null のあいだは番号を入れない
  const [pageNumber, setPageNumber] = useState<PageNumberOptions | null>(null);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  // ダイアログの中でいじっている途中の設定 (「入れる」を押すまで反映しない)
  const [draft, setDraft] = useState<PageNumberOptions>(DEFAULT_PAGE_NUMBER);

  const boxWidth = THUMBNAIL_WIDTH_PX[settings.thumbnailSize];

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
      try {
        for (const file of files) {
          const { source, pages } = await loadAnyFile(file);
          deck.addSource(source, pages);
        }
        snackbar.success(`${files.length}件のファイルを読み込みました。`);
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    },
    [deck, handleError, snackbar],
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

  const exportPdf = useCallback(async () => {
    if (deck.pages.length === 0) return;
    setBusy(true);
    try {
      const bytes = await buildPdfFromPages(deck.sources, deck.pages, pageNumber);
      const name = `${baseName(firstSourceName ?? 'document')}${settings.organizeSuffix}.pdf`;
      saveBytes(bytes, name);
      snackbar.success(`${deck.pages.length}ページのPDFを書き出しました。`);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [deck.pages, deck.sources, firstSourceName, settings.organizeSuffix, snackbar, handleError, pageNumber]);

  const hasPages = deck.pages.length > 0;
  // 読み込んだページはどこにも保存していないので、閉じる前に引き止める
  useUnloadGuard(hasPages);
  const numberedCount = Math.max(0, deck.pages.length - (draft.skipFirst ? 1 : 0));
  const lastNumber = draft.startAt + Math.max(0, numberedCount - 1);
  // 選択なしで全ページに効くのは意外なので、ボタン自体に書いておく
  const rotateLabel = selected.size > 0 ? `選択した${selected.size}ページを` : '全ページを';
  const totalBytes = useMemo(
    () => [...deck.sources.values()].reduce((sum, source) => sum + source.byteLength, 0),
    [deck.sources],
  );

  return (
    <div className="page">
      {hasPages ? (
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
      </div>

      {!hasPages ? (
        <EmptyState icon="pages" title="まだページがありません">
          PDFや画像を読み込むとページの一覧が表示されます。
        </EmptyState>
      ) : (
        <>
          <div className="toolbar">
            <Button
              small
              variant="outlined"
              icon="rotate_left"
              onClick={() => deck.rotatePages(selected.size > 0 ? selected : null, -90)}
            >
              {rotateLabel}左に回転
            </Button>
            <Button
              small
              variant="outlined"
              icon="rotate_right"
              onClick={() => deck.rotatePages(selected.size > 0 ? selected : null, 90)}
            >
              {rotateLabel}右に回転
            </Button>
            <span className="toolbar__divider" />

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
            <span className="toolbar__divider" />

            {selected.size > 0 ? (
              <>
                <span className="chip">{selected.size}ページ選択中</span>
                <Button small variant="outlined" icon="file_copy" onClick={() => deck.duplicatePages(selected)}>
                  複製
                </Button>
                <Button small variant="danger" icon="delete" onClick={deleteSelected}>
                  削除
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
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

        </>
      )}

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
