import type { TaskStatus } from '@/types';

// status tints a session/block regardless of its subject color:
// done → green, not-done → red, pending → its own color
export function statusColor(color: string, status: TaskStatus): string {
  if (status === 'done') return 'var(--green)';
  if (status === 'notdone') return 'var(--red)';
  return color;
}

export function statusGradient(color: string, status: TaskStatus): string {
  if (status === 'done') {
    return 'linear-gradient(135deg, var(--green), var(--green-dark))';
  }
  if (status === 'notdone') {
    return 'linear-gradient(135deg, var(--red), var(--red-dark))';
  }
  return `linear-gradient(135deg, ${color}, ${shade(color, -18)})`;
}

// 11 colors, biased toward the project's warm coral/amber theme so subject
// swatches don't clash with the accent (#ff5a3c), done (#00e676), or
// not-done (#ff1744) palettes. The cool blue/violet/pink anchor the spread.
export const PALETTE = [
  '#ff5a3c', // coral (project accent)
  '#f59e0b', // amber
  '#fb923c', // warm orange
  '#facc15', // yellow
  '#84cc16', // lime
  '#10b981', // emerald
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
];

/** lighten (positive) or darken (negative) a hex color by `percent` of 255. */
export function shade(hex: string, percent: number): string {
  const c = hex.replace('#', '');
  const num = parseInt(c, 16);
  let r = (num >> 16) + Math.round((255 * percent) / 100);
  let g = ((num >> 8) & 0xff) + Math.round((255 * percent) / 100);
  let b = (num & 0xff) + Math.round((255 * percent) / 100);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** Map a subject name to a stable color from the palette. */
export function makeColorPicker(initial: Record<string, string> = {}) {
  const map: Record<string, string> = { ...initial };
  return {
    get(subject: string): string {
      if (!map[subject]) {
        const used = Object.values(map);
        let chosen = PALETTE.find((c) => !used.includes(c));
        if (!chosen) chosen = PALETTE[Object.keys(map).length % PALETTE.length];
        map[subject] = chosen;
      }
      return map[subject];
    },
    snapshot(): Record<string, string> {
      return { ...map };
    },
  };
}
