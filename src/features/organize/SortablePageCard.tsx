import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ThumbnailCache } from '../../core/pdf/render';
import type { PageRef, PdfSource } from '../../core/pdf/types';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { PageThumbnail } from '../../ui/PageThumbnail';

export interface SortablePageCardProps {
  page: PageRef;
  index: number;
  total: number;
  source: PdfSource;
  cache: ThumbnailCache;
  boxWidth: number;
  selected: boolean;
  onToggleSelect: (id: string, selected: boolean) => void;
  onRotate: (id: string, delta: number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, offset: number) => void;
}

export function SortablePageCard({
  page,
  index,
  total,
  source,
  cache,
  boxWidth,
  selected,
  onToggleSelect,
  onRotate,
  onDelete,
  onDuplicate,
  onMove,
}: SortablePageCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });

  const classes = ['page-card', isDragging ? 'page-card--dragging' : '', selected ? 'page-card--selected' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      className={classes}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="page-card__top">
        <span className="page-card__badge">{index + 1}</span>

        {/*
          並べ替えはこのつまみからだけ始める。
          カード全体をつまみにすると、タッチ操作でページ一覧を縦スクロールできなくなる
          (ドラッグ開始のために touch-action: none が必要なため)。
        */}
        <button
          type="button"
          className="page-card__drag"
          ref={setActivatorNodeRef}
          aria-label={`${index + 1}ページ目をドラッグして並べ替える`}
          title="ドラッグして並べ替え"
          {...attributes}
          {...listeners}
        >
          <Icon name="drag_indicator" size={18} />
        </button>

        <input
          className="page-card__check"
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggleSelect(page.id, event.target.checked)}
          aria-label={`${index + 1}ページ目を選択`}
        />
      </div>

      <PageThumbnail
        cache={cache}
        source={source}
        pageIndex={page.sourceIndex}
        rotation={page.rotation}
        boxWidth={boxWidth}
        alt={`${index + 1}ページ目のプレビュー`}
      />

      <div className="page-card__meta" title={source.name}>
        {source.name}
      </div>

      <div className="page-card__actions">
        <IconButton
          icon="chevron_left"
          label="前へ移動"
          small
          disabled={index === 0}
          onClick={() => onMove(page.id, -1)}
        />
        <IconButton icon="rotate_left" label="左に回転" small onClick={() => onRotate(page.id, -90)} />
        <IconButton icon="rotate_right" label="右に回転" small onClick={() => onRotate(page.id, 90)} />
        <IconButton icon="file_copy" label="複製" small onClick={() => onDuplicate(page.id)} />
        <IconButton icon="delete" label="削除" small danger onClick={() => onDelete(page.id)} />
        <IconButton
          icon="chevron_right"
          label="次へ移動"
          small
          disabled={index === total - 1}
          onClick={() => onMove(page.id, 1)}
        />
      </div>
    </div>
  );
}
