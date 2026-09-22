// Notepad helpers. A note has no title field — the list derives one from the
// first non-empty line of the body, so nothing has to be kept in sync.

import type { Note } from '@/types';

const TITLE_MAX = 80;
const SNIPPET_MAX = 100;

/** First non-empty line, trimmed and capped. 'untitled' when the body is blank. */
export function deriveTitle(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed.length > TITLE_MAX ? trimmed.slice(0, TITLE_MAX).trimEnd() + '…' : trimmed;
    }
  }
  return 'untitled';
}

/** Everything after the title line, collapsed to one line, for the list preview. */
export function deriveSnippet(text: string): string {
  const lines = text.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx === -1) return '';
  const rest = lines
    .slice(firstIdx + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ');
  return rest.length > SNIPPET_MAX ? rest.slice(0, SNIPPET_MAX).trimEnd() + '…' : rest;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" — matches the sync pill's style. */
export function fmtAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function sortByUpdated(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Word count for the editor stats + card footers. */
export function countWords(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** "1 min read" style estimate at ~200 wpm; empty text → ''. */
export function readingTime(text: string): string {
  const w = countWords(text);
  if (w === 0) return '';
  const mins = Math.max(1, Math.round(w / 200));
  return `${mins} min read`;
}
