// Subject catalog helpers — name normalization, palette suggestion, and a
// hook that returns the whole catalog for a render site to look up by name.
// Sessions store the subject *name* text only; render sites resolve the live
// color here so a recolor in settings propagates everywhere with zero writes.

import { useMemo } from 'react';
import { useSubjectStore } from '@/store/useSubjectStore';
import { PALETTE } from '@/lib/color';
import type { Subject } from '@/types';

export function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Subscribe to the subject store and return a memoised `name → color` map
 * keyed by normalized (trimmed, case-folded) name. Render sites should call
 * this once at the top and resolve `session.color` through it.
 */
export function useSubjectColorMap(): Map<string, string> {
  const subjects = useSubjectStore((s) => s.subjects);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) map.set(normalize(s.name), s.color);
    return map;
  }, [subjects]);
}

/**
 * Suggest a palette color that's not already taken by the catalog.
 * Falls back to cycling the palette when it's exhausted.
 */
export function suggestColor(subjects: readonly Subject[]): string {
  const used = new Set(subjects.map((s) => s.color.toLowerCase()));
  const next = PALETTE.find((c) => !used.has(c.toLowerCase()));
  if (next) return next;
  return PALETTE[subjects.length % PALETTE.length];
}
