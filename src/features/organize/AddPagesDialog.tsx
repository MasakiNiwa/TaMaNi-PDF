import { useMemo, useState } from 'react';
import type { ThumbnailCache } from '../../core/pdf/render';
import type { PageRef, PdfSource } from '../../core/pdf/types';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { PageThumbnail } from '../../ui/PageThumbnail';

/**
 * 追加しようとしているPDFの中身を見せて、入れるページを選ぶ。
 *
 * 追加はすべて一括で入っていたが、必要なのは一部だけということがある。
 * あとから消すより、入れる前に選ぶほうが手数が少ない。
 *
 * 「毎回選ぶのは煩わしい」人のために、設定で確認なしの一括追加も選べる。
 */

export interface PendingAdd {
  source: PdfSource;
  pages: PageRef[];
}

export interface AddPagesDialogProps {
  entry: PendingAdd;
  cache: ThumbnailCache;
  /** 残り何件のファイルが控えているか (2件目以降があることを伝える) */
  remaining: number;
  onCancel: () => void;
  onAdd: (pages: PageRef[]) => void;
}

export function AddPagesDialog({ entry, cache, remaining, onCancel, onAdd }: AddPagesDialogProps) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const all = useMemo(() => entry.pages.map((page) => page.id), [entry.pages]);

  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog
      open
      wide
      title={`追加するページを選ぶ (${entry.source.name})`}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>このファイルは追加しない</Button>
          <Button
            variant="tonal"
            disabled={picked.size === 0}
            onClick={() => onAdd(entry.pages.filter((page) => picked.has(page.id)))}
          >
            選んだ{picked.size}ページを追加
          </Button>
          <Button variant="filled" onClick={() => onAdd(entry.pages)}>
            すべて追加 ({entry.pages.length})
          </Button>
        </>
      }
    >
      <p className="text-small muted">
        入れたいページを押して選びます。選ばずに「すべて追加」でも構いません。
        {remaining > 0 ? ` (このあと ${remaining}件のファイルが続きます)` : ''}
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <Button small onClick={() => setPicked(new Set(all))}>
          すべて選択
        </Button>
        <Button small disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
          選択解除
        </Button>
      </div>

      <div className="add-grid">
        {entry.pages.map((page, index) => {
          const on = picked.has(page.id);
          return (
            <button
              key={page.id}
              type="button"
              className={`add-grid__item${on ? ' add-grid__item--on' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(page.id)}
            >
              <span className="add-grid__badge">{index + 1}</span>
              <PageThumbnail
                cache={cache}
                source={entry.source}
                pageIndex={page.sourceIndex}
                boxWidth={120}
                alt={`${index + 1}ページ目`}
              />
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
