// #/notes — the notepad, as a searchable card grid (Keep/Notion style).
// Cards render from stored metadata (title + snippet + updatedAt), so the
// list costs one KV list operation regardless of how many notes exist.
// Search and sort are purely client-side over those rows. The dedicated
// refresh button re-fetches the list; clicking a card opens that note
// (#/notes/:id), which fetches only its body.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNoteStore } from '@/store/useNoteStore';
import { fmtAgo } from '@/lib/notes';
import { refreshNotesList } from '@/features/sync/useCloudSync';
import { SyncPill } from '@/components/SyncPill';
import { goNotes, goPlanner } from '@/lib/useHashRoute';

type SortKey = 'updated' | 'created' | 'title';
const SORT_STORAGE_KEY = 'studyplan_notes_sort';

function loadSort(): SortKey {
  const v = localStorage.getItem(SORT_STORAGE_KEY);
  return v === 'created' || v === 'title' ? v : 'updated';
}

const SORT_LABEL: Record<SortKey, string> = {
  updated: 'recent',
  created: 'newest',
  title: 'a–z',
};

export function NotesPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const notes = useNoteStore((s) => s.notes);
  const add = useNoteStore((s) => s.add);

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(loadSort);

  // re-render every 30s so the "2m ago" labels stay honest
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const onSort = (key: SortKey) => {
    setSort(key);
    localStorage.setItem(SORT_STORAGE_KEY, key);
  };

  const onCreate = () => {
    const note = add('');
    goNotes(note.id);
  };

  // dedicated refresh: push pending note writes, then re-fetch the list
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshNotesList();
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            (n.snippet || '').toLowerCase().includes(q),
        )
      : [...notes];
    switch (sort) {
      case 'created':
        return filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      case 'title':
        return filtered.sort((a, b) =>
          (a.title || '').localeCompare(b.title || '', [], { sensitivity: 'base' }),
        );
      default:
        return filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
  }, [notes, query, sort]);

  const searching = query.trim().length > 0;

  return (
    <div className="notes-page">
      <header className="notes-head">
        <button
          className="notes-icon-btn"
          onClick={goPlanner}
          aria-label="back to planner"
          title="back to planner"
        >
          ←
        </button>
        <h2 className="notes-title">
          notepad{' '}
          <span className="notes-count">
            {notes.length === 0
              ? ''
              : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
          </span>
        </h2>
        <button
          type="button"
          className="notes-refresh-btn"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          title="refresh the notes list"
        >
          {refreshing ? 'refreshing…' : '↻ refresh'}
        </button>
        <button className="notes-new-btn" onClick={onCreate}>
          + new note
        </button>
        <SyncPill onClick={onOpenSettings} />
      </header>

      {notes.length > 0 && (
        <div className="notes-toolbar">
          <label className="notes-search">
            <span className="notes-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search notes…"
              aria-label="search notes"
            />
            {searching && (
              <button
                type="button"
                className="notes-search-clear"
                onClick={() => setQuery('')}
                aria-label="clear search"
              >
                ✕
              </button>
            )}
          </label>
          <div className="notes-sort" role="group" aria-label="sort notes">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={'notes-sort-btn' + (sort === key ? ' active' : '')}
                onClick={() => onSort(key)}
                aria-pressed={sort === key}
              >
                {SORT_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <div className="notes-empty">
          <p className="notes-empty-title">a quiet page, waiting</p>
          <p>capture anything — ideas, links, tomorrow’s plan.</p>
          <button className="notes-new-btn" onClick={onCreate}>
            + new note
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="notes-empty">
          <p className="notes-empty-title">nothing matches “{query.trim()}”</p>
          <p>try a different word, or start a fresh note.</p>
          <button className="notes-new-btn" onClick={onCreate}>
            + new note
          </button>
        </div>
      ) : (
        <motion.ul className="notes-grid" layout>
          <AnimatePresence mode="popLayout">
            {!searching && (
              <motion.li
                layout
                key="new-note-tile"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              >
                <button
                  type="button"
                  className="note-card note-card-new"
                  onClick={onCreate}
                >
                  <span className="note-card-new-plus" aria-hidden="true">
                    +
                  </span>
                  <span className="note-card-new-label">new note</span>
                </button>
              </motion.li>
            )}
            {visible.map((n) => (
              <motion.li
                layout
                key={n.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              >
                <button className="note-card" onClick={() => goNotes(n.id)}>
                  <span className="note-card-title">{n.title}</span>
                  {n.snippet && (
                    <span className="note-card-snippet">{n.snippet}</span>
                  )}
                  <span className="note-card-foot">
                    <span className="note-card-time">{fmtAgo(n.updatedAt)}</span>
                    <span className="note-card-open" aria-hidden="true">
                      open →
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}
