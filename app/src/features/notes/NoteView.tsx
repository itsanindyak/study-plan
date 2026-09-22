// #/notes/:id — one note, full width.
//
// The body is fetched from the database when the note is opened (one read),
// with the locally cached copy painted first so opening is instant offline.
// Editing uses an explicit save: the textarea is a local draft and nothing is
// written to the store (or pushed) until "save" (or Ctrl/Cmd+S). Unsaved
// changes are flagged, and navigating away or closing the tab warns first.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNoteStore } from '@/store/useNoteStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { countWords, deriveTitle, fmtAgo, readingTime } from '@/lib/notes';
import { fetchNoteBody, waitForSaved } from '@/features/sync/useCloudSync';
import { SyncPill } from '@/components/SyncPill';
import { goNotes } from '@/lib/useHashRoute';

export function NoteView({ id, onOpenSettings }: { id: string; onOpenSettings: () => void }) {
  // App renders this with key={id}, so switching notes remounts and the draft
  // initialises from the right note without an id-change effect.
  const note = useNoteStore((s) => s.notes.find((n) => n.id === id));
  const updateText = useNoteStore((s) => s.updateText);
  const remove = useNoteStore((s) => s.remove);

  const [draft, setDraft] = useState(() => note?.text ?? '');
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const dirty = note ? draft !== note.text : false;

  // cloud save progress: the store write is instant, but the toast stays up
  // until waitForSaved confirms the push actually landed (or was blocked)
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saveInFlight = useRef(false);

  const saveNow = useCallback(() => {
    if (!dirty) return;
    updateText(id, draft);
    // without a token localStorage IS the database — nothing to wait for
    if (!useSettingsStore.getState().token || saveInFlight.current) return;
    saveInFlight.current = true;
    setSavePhase('saving');
    void waitForSaved().then((result) => {
      saveInFlight.current = false;
      setSavePhase(result === 'saved' ? 'saved' : 'failed');
      setTimeout(() => setSavePhase((p) => (saveInFlight.current ? p : 'idle')), 1800);
    });
  }, [dirty, draft, id, updateText]);

  // open the note: paint the cached body, then fetch the fresh one from the
  // database. The draft is only replaced if the user hasn't typed meanwhile.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    void fetchNoteBody(id, ctrl.signal)
      .then((fresh) => {
        if (cancelled || !fresh) return;
        setDraft((prev) => (prev === '' || prev === note?.text ? fresh.text ?? '' : prev));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // note?.text deliberately omitted: only re-fetch when the note id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // refresh the "last updated" label periodically
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // a reload or tab-close with unsaved text is the one way this design can lose
  // work, so ask before letting it happen
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const onSave = () => {
    saveNow();
  };

  const onBack = () => {
    if (dirty && !window.confirm('Discard unsaved changes to this note?')) return;
    goNotes();
  };

  const onDelete = () => {
    if (!note) return;
    const msg = dirty
      ? `Delete "${deriveTitle(draft)}"? Unsaved changes will be lost.`
      : `Delete "${note.title}"?`;
    if (window.confirm(msg)) {
      remove(id);
      goNotes();
    }
  };

  // Ctrl/Cmd+S saves without leaving the keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNow();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  if (!note) {
    return (
      <div className="notes-page">
        <header className="notes-head">
          <button
            className="notes-icon-btn"
            onClick={() => goNotes()}
            aria-label="back to notes"
            title="back to notes"
          >
            ←
          </button>
          <h2 className="notes-title">not found</h2>
          <SyncPill onClick={onOpenSettings} />
        </header>
        <div className="notes-empty">
          <p>this note is gone</p>
          <button className="notes-new-btn" onClick={() => goNotes()}>
            back to notes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="notes-page">
      <header className="notes-head">
        <button
          className="notes-icon-btn"
          onClick={onBack}
          aria-label="back to notes"
          title="back to notes"
        >
          ←
        </button>
        <h2 className="notes-title">{deriveTitle(draft)}</h2>
        <button className="notes-del-btn" onClick={onDelete} title="delete note">
          delete
        </button>
        <SyncPill onClick={onOpenSettings} />
      </header>

      <div className="note-paper">
        <textarea
          className="note-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={loading ? 'reading the note from the cloud…' : 'write anything… then press save'}
          spellCheck={false}
        />

        <footer className="note-foot">
          <span className="note-foot-meta">
            {(() => {
              const words = countWords(draft);
              const read = readingTime(draft);
              const updated = note.updatedAt
                ? `updated ${fmtAgo(note.updatedAt, now)}`
                : 'not saved yet';
              return (
                <>
                  {words > 0 && (
                    <>
                      {words} word{words === 1 ? '' : 's'}
                      {read && ` · ${read}`} ·{' '}
                    </>
                  )}
                  {updated}
                </>
              );
            })()}
            {dirty && <span className="note-dirty"> · unsaved changes</span>}
          </span>
          <button
            type="button"
            className="note-save-btn"
            onClick={onSave}
            disabled={!dirty}
            title="save (Ctrl+S)"
          >
            {dirty ? 'save' : 'saved'}
          </button>
        </footer>
      </div>

      {savePhase !== 'idle' && (
        <div className={'save-toast is-' + savePhase} role="status" aria-live="polite">
          {savePhase === 'saving' && (
            <>
              <span className="save-toast-spin" aria-hidden="true" />
              saving to cloud…
            </>
          )}
          {savePhase === 'saved' && <>saved ✓</>}
          {savePhase === 'failed' && <>saved on this device — cloud retrying…</>}
        </div>
      )}
    </div>
  );
}
