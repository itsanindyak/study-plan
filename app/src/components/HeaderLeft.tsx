import type { ReactNode } from 'react';
import { Brand } from './Brand';

interface HeaderLeftProps {
  actionLabel: string;
  actionIcon: ReactNode;
  onAction: () => void;
  actionTitle?: string;
  variant?: 'default' | 'focus';
}

export function HeaderLeft({
  actionLabel,
  actionIcon,
  onAction,
  actionTitle,
  variant = 'default',
}: HeaderLeftProps) {
  const cls = variant === 'focus' ? 'header-left header-left--focus' : 'header-left';
  return (
    <div className={cls}>
      <Brand />
      <button
        type="button"
        className="header-action"
        onClick={onAction}
        title={actionTitle}
        aria-label={actionTitle}
      >
        {actionIcon}
        <span>{actionLabel}</span>
      </button>
    </div>
  );
}
