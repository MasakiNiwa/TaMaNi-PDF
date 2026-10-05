import { useEffect, useState } from 'react';
import {
  IMAGE_FORMAT_ORDER,
  IMAGE_FORMATS,
  availableFormats,
  type ImageFormat,
} from '../../core/image/pageImages';
import { IMAGE_EXPORT_DPI } from '../../core/storage/settings';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { ProgressBar } from '../../ui/primitives';

/**
 * ページを画像で保存するときの、形式と解像度を選ぶ。
 * 1ページなら画像1枚、2ページ以上なら ZIP にまとめる (呼び出し側で行う)。
 */

const DPI_LABEL: Record<number, string> = {
  96: '画面で見る (96dpi)',
  150: '標準 (150dpi)',
  300: '印刷する (300dpi)',
};

export interface ImageExportDialogProps {
  open: boolean;
  /** 「選択した3ページ」「全12ページ」など */
  targetLabel: string;
  count: number;
  format: ImageFormat;
  dpi: number;
  progress: { done: number; total: number } | null;
  onChange: (next: { format?: ImageFormat; dpi?: number }) => void;
  onExport: () => void;
  onAbort: () => void;
  onClose: () => void;
}

export function ImageExportDialog({
  open,
  targetLabel,
  count,
  format,
  dpi,
  progress,
  onChange,
  onExport,
  onAbort,
  onClose,
}: ImageExportDialogProps) {
  const [available, setAvailable] = useState<Set<ImageFormat> | null>(null);

  useEffect(() => {
    if (!open || available) return;
    void availableFormats().then(setAvailable);
  }, [open, available]);

  // 前回選んだ形式がこのブラウザで使えないときは、PNG に戻しておく
  const usable = available ? available.has(format) : true;
  useEffect(() => {
    if (available && !available.has(format)) onChange({ format: 'png' });
  }, [available, format, onChange]);

  const running = progress !== null;

  return (
    <Dialog
      open={open}
      title="画像で保存"
      persistent={running}
      onClose={onClose}
      actions={
        running ? (
          <Button variant="danger" icon="stop" onClick={onAbort}>
            中止
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>キャンセル</Button>
            <Button variant="filled" icon="download" disabled={!usable} onClick={onExport}>
              {count === 1 ? '画像を保存' : `${count}枚をZIPで保存`}
            </Button>
          </>
        )
      }
    >
      <p className="text-small muted" style={{ marginTop: 0 }}>
        {targetLabel}を画像にします。{count === 1 ? '' : '2ページ以上のときは、ZIP にまとめて保存します。'}
      </p>

      <fieldset className="plain-fieldset" disabled={running}>
        <legend className="field__label">形式</legend>
        <div className="stack">
          {IMAGE_FORMAT_ORDER.map((id) => {
            const info = IMAGE_FORMATS[id];
            const supported = available ? available.has(id) : true;
            return (
              <label
                key={id}
                className={`choice${format === id ? ' choice--on' : ''}${supported ? '' : ' choice--disabled'}`}
              >
                <input
                  type="radio"
                  name="image-format"
                  value={id}
                  checked={format === id}
                  disabled={!supported}
                  onChange={() => onChange({ format: id })}
                />
                <span>
                  <span className="choice__title">{info.label}</span>
                  <span className="choice__desc">
                    {supported ? info.hint : 'このブラウザでは書き出せません'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="field" style={{ marginTop: 16 }}>
        <label className="field__label" htmlFor="image-dpi">
          解像度
        </label>
        <select
          id="image-dpi"
          className="select"
          value={dpi}
          disabled={running}
          onChange={(event) => onChange({ dpi: Number(event.target.value) })}
        >
          {IMAGE_EXPORT_DPI.map((value) => (
            <option key={value} value={value}>
              {DPI_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      {running ? (
        <div style={{ marginTop: 16 }} role="status">
          <p className="text-small" style={{ margin: '0 0 6px' }}>
            画像にしています… {progress.done} / {progress.total}
          </p>
          <ProgressBar value={progress.done} max={progress.total} />
        </div>
      ) : null}
    </Dialog>
  );
}
