import { type ReactNode } from 'react';

export function IconButton({
  onClick,
  label,
  title,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label={label} title={title}>
      {children}
    </button>
  );
}
