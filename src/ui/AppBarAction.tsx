import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export interface AppBarActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** アイコンの下に出す短い名前 */
  label: string;
  /** 読み上げやツールチップ用の説明 (省略時は label を使う) */
  description?: string;
  danger?: boolean;
}

/**
 * アプリバーに並べる操作ボタン。
 *
 * アイコンだけだと何のボタンか分からないので、下に小さく名前を出す。
 * 縦に積むぶん高さを使うが、アプリバーの高さには収まる大きさにしてある。
 */
export function AppBarAction({
  icon,
  label,
  description,
  danger,
  className,
  type = 'button',
  ...rest
}: AppBarActionProps) {
  const classes = ['appbar-action', danger ? 'appbar-action--danger' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} aria-label={description ?? label} title={description ?? label} {...rest}>
      <Icon name={icon} size={20} />
      <span className="appbar-action__label">{label}</span>
    </button>
  );
}
