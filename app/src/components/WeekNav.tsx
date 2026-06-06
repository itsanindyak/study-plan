import type { ReactNode } from 'react';

interface Props {
  weekLabel: string;
  onPrev: () => void;
  onNext: () => void;
  children?: ReactNode;
}

export function WeekNav({ weekLabel, onPrev, onNext, children }: Props) {
  return (
    <div className="week-nav">
      <button onClick={onPrev} aria-label="previous week">←</button>
      <span className="week-label">{weekLabel}</span>
      <button onClick={onNext} aria-label="next week">→</button>
      {children}
    </div>
  );
}
