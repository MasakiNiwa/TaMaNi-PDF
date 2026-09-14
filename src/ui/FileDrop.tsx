import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { Icon, type IconName } from './Icon';

export interface FileDropProps {
  accept: string;
  multiple?: boolean;
  title: string;
  hint?: string;
  icon?: IconName;
  compact?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/**
 * ファイルの選択とドラッグ&ドロップ。
 * 受け取ったファイルはそのまま呼び出し側に渡すだけで、どこにも送信しない。
 */
export function FileDrop({
  accept,
  multiple = false,
  title,
  hint,
  icon = 'upload',
  compact,
  disabled,
  onFiles,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const inputId = useId();

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(multiple ? [...list] : [list[0]]);
    },
    [multiple, onFiles],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      className={`dropzone${active ? ' dropzone--active' : ''}${compact ? ' dropzone--compact' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-describedby={hint ? inputId : undefined}
    >
      <Icon className="dropzone__icon" name={icon} size={compact ? 20 : 32} />
      <div>
        <div className="dropzone__title">{title}</div>
        {hint ? (
          <div className="dropzone__hint" id={inputId}>
            {hint}
          </div>
        ) : null}
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          // 同じファイルを続けて選べるようにリセットする
          event.target.value = '';
        }}
      />
    </div>
  );
}
