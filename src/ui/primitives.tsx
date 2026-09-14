import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type BannerTone = 'info' | 'privacy' | 'warning' | 'error';

const BANNER_ICON: Record<BannerTone, IconName> = {
  info: 'info',
  privacy: 'shield',
  warning: 'warning',
  error: 'error',
};

export function Banner({
  tone = 'info',
  icon,
  children,
}: {
  tone?: BannerTone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className={`banner${tone === 'info' ? '' : ` banner--${tone}`}`}>
      <Icon className="banner__icon" name={icon ?? BANNER_ICON[tone]} size={20} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon = 'pages',
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon className="empty-state__icon" name={icon} size={40} />
      <h3>{title}</h3>
      {children ? <div className="text-small">{children}</div> : null}
    </div>
  );
}

export function ProgressBar({ value, max }: { value?: number; max?: number }) {
  const indeterminate = value === undefined || max === undefined || max <= 0;
  const percent = indeterminate ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      className={`progress${indeterminate ? ' progress--indeterminate' : ''}`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__bar" style={indeterminate ? undefined : { width: `${percent}%` }} />
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__item"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={16} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="switch-row">
      <div className="switch-row__text">
        <div className="switch-row__title">{title}</div>
        {description ? <div className="switch-row__desc">{description}</div> : null}
      </div>
      <div className="switch-row__control">{children}</div>
    </div>
  );
}
