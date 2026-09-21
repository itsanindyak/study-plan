// Swatch picker: a row of color swatches from the project palette so users
// pick from the curated set rather than the native color dialog. Used by the
// Settings → Subjects tab (add row and per-row recolor).

import { PALETTE } from '@/lib/color';

export function SwatchPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (color: string) => void;
  compact?: boolean;
}) {
  const current = value.toLowerCase();
  return (
    <div
      className={'swatch-picker' + (compact ? ' compact' : '')}
      role="radiogroup"
      aria-label="color"
    >
      {PALETTE.map((c) => {
        const selected = c.toLowerCase() === current;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            title={c}
            className={'swatch' + (selected ? ' selected' : '')}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        );
      })}
    </div>
  );
}
