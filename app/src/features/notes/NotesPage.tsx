// #/notes — the notepad list. Rows render from stored metadata (title +
// snippet + updatedAt), so the list costs one KV list operation regardless of
// how many notes exist. The dedicated refresh button re-fetches the list;
// clicking a row opens that note (#/notes/:id), which fetches only its body.

import { useEffect, useState } from 'react';
import { useNoteStore } from '@/store/useNoteStore';
import { fmtAgo } from '@/lib/notes';
import { refreshNotesList } from '@/features/sync/useCloudSync';
import { SyncPill } from '@/components/SyncPill';
import { goNotes, goPlanner } from '@/lib/useHashRoute';

export function NotesPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const notes = useNoteStore((s) => s.notes);
  const add = useNoteStore((s) => s.add);

  const [refreshing, setRefreshing] = useState(false);

  // re-render every 30s so the "2m ago" labels stay honest
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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
        <h2 className="notes-title">notepad</h2>
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

      {notes.length === 0 ? (
        <div className="notes-empty">
          <p>no notes yet</p>
          <button className="notes-new-btn" onClick={onCreate}>
            + new note
          </button>
        </div>
      ) : (
        <ul className="notes-list">
          {notes.map((n) => (
            <li key={n.id}>
              <button className="note-row" onClick={() => goNotes(n.id)}>
                <span className="note-row-top">
                  <span className="note-row-title">{n.title}</span>
                  <span className="note-row-time">{fmtAgo(n.updatedAt)}</span>
                </span>
                {n.snippet && <span className="note-row-snippet">{n.snippet}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
