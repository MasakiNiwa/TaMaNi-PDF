import { useCallback, useMemo, useState } from 'react';
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
import { buildPdfFromPages } from '../../core/pdf/assemble';
import { PdfUserError } from '../../core/pdf/errors';
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

export function OrganizePage() {
  const deck = usePageDeck();
  const snackbar = useSnackbar();
  const { settings } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const boxWidth = THUMBNAIL_WIDTH_PX[settings.thumbnailSize];

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
      const bytes = await buildPdfFromPages(deck.sources, deck.pages);
      const name = `${baseName(firstSourceName ?? 'document')}${settings.organizeSuffix}.pdf`;
      saveBytes(bytes, name);
      snackbar.success(`${deck.pages.length}ページのPDFを書き出しました。`);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [deck.pages, deck.sources, firstSourceName, settings.organizeSuffix, snackbar, handleError]);

  const hasPages = deck.pages.length > 0;
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
        <p className="page__lead">
          ページの並べ替え・回転・追加・削除をして、1つのPDFとして書き出します。文字は文字のまま残ります。
        </p>
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
          <p>
            PDFや画像を読み込むとページの一覧が表示されます。
            <br />
            何もないところから作り始めることもできます。
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Button variant="tonal" icon="note_add" onClick={addBlankPage} disabled={busy}>
              空白ページから始める
            </Button>
          </div>
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
            <span className="toolbar__divider" />

            <Button small variant="outlined" icon="note_add" onClick={addBlankPage} disabled={busy}>
              空白ページ
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

          </div>

          <p className="text-small muted" style={{ marginBottom: 12 }}>
            全{deck.pages.length}ページ / 読み込み済み {deck.sources.size}ファイル ({formatBytes(totalBytes)})
            {selected.size === 0 ? ' ・ 回転ボタンは選択がないとき全ページに効きます' : ''}
          </p>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={deck.pages.map((page) => page.id)} strategy={rectSortingStrategy}>
              <div
                className="page-grid"
                style={{ ['--page-card-width' as string]: `${boxWidth + 24}px` }}
              >
                {deck.pages.map((page, index) => {
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

          <div className="row" style={{ marginTop: 20 }}>
            <Button variant="outlined" icon="delete" onClick={() => setConfirmClear(true)}>
              クリア
            </Button>
            <span className="spacer" />
            <Button variant="filled" icon="download" onClick={exportPdf} disabled={busy}>
              PDFを書き出す
            </Button>
          </div>
        </>
      )}

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
