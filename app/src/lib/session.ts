import type { Session } from '@/types';

// A break is a non-study block on the day: it occupies the timeline like a
// session but is excluded from study totals and Focus Mode. `kind` absent on
// older records means a normal study session.
export function isBreak(s: Pick<Session, 'kind'>): boolean {
  return s.kind === 'break';
}

// Neutral fill for break blocks — readable with white text in both themes and
// intentionally distinct from the warm subject palette.
export const BREAK_COLOR = '#6b7280';

// Shown when a break has no label of its own.
export const BREAK_LABEL = 'break';

// What a break row displays as its title.
export function breakTitle(session: { topic?: string; subject?: string }): string {
  return (session.topic || '').trim() || (session.subject || '').trim() || BREAK_LABEL;
}
