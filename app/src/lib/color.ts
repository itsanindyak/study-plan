export const PALETTE = [
  '#6366f1',
  '#ec4899',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#f43f5e',
  '#14b8a6',
  '#ef4444',
  '#84cc16',
  '#3b82f6',
  '#a855f7',
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
