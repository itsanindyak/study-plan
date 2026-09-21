// ColorMenu: a trigger button that opens a small popover showing the project
// color palette. Used in Settings → Subjects (add row trigger + per-row
// recolor trigger) so the 11 palette colors stay tucked away until clicked,
// instead of always taking up a row of swatches.

import { useEffect, useRef, useState } from 'react';
import { SwatchPicker } from './SwatchPicker';

export function ColorMenu({
  value,
  onChange,
  compact = false,
  label = 'color',
}: {
  value: string;
  onChange: (color: string) => void;
  compact?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // outside click + Escape close the popover
  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={'color-menu' + (compact ? ' compact' : '')} ref={containerRef}>
      <button
        type="button"
        className="color-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={value}
      >
        <span className="color-menu-swatch" style={{ background: value }} />
        {!compact && <span className="color-menu-caret">▾</span>}
      </button>
      {open && (
        <div className="color-menu-pop" role="dialog" aria-label="palette">
          <SwatchPicker
            compact
            value={value}
            onChange={(c) => {
              onChange(c);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
