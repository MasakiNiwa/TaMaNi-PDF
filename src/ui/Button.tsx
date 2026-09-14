import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  trailingIcon?: IconName;
  small?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'text',
  icon,
  trailingIcon,
  small,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    small ? 'btn--small' : '',
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {icon ? <Icon name={icon} size={small ? 16 : 18} /> : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} size={small ? 16 : 18} /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** スクリーンリーダー向けの説明。ツールチップにも使う。 */
  label: string;
  small?: boolean;
  filled?: boolean;
  danger?: boolean;
  active?: boolean;
}

export function IconButton({
  icon,
  label,
  small,
  filled,
  danger,
  active,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const classes = [
    'icon-btn',
    small ? 'icon-btn--small' : '',
    filled ? 'icon-btn--filled' : '',
    danger ? 'icon-btn--danger' : '',
    active ? 'icon-btn--active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={small ? 18 : 20} />
    </button>
  );
}
