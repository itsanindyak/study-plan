import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Note } from '@/types';
import { newId } from '@/lib/id';
import { normalizeNote } from '@/lib/status';
import { deriveTitle, deriveSnippet, sortByUpdated } from '@/lib/notes';

// A note's list row (title/snippet/timestamps) is metadata; the body is only
// held for notes this device has opened or created, so the store stays small
// while the list can still render every row.

interface NoteState {
  notes: Note[];

  get: () => Note[];
  add: (text?: string) => Note;
  updateText: (id: string, text: string) => void;
  remove: (id: string) => void;
  replaceAll: (next: Note[]) => void;
  // hydrate one note's body from a per-note fetch — never marks it dirty
  applyFetched: (note: Note) => void;
}

function withTitle(text: string): { title: string; snippet: string } {
  return { title: deriveTitle(text), snippet: deriveSnippet(text) };
}

export const useNoteStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],

      get: () => get().notes,

      add: (text = '') => {
        const now = Date.now();
        const note: Note = { id: newId(), ...withTitle(text), text, createdAt: now, updatedAt: now };
        set((s) => ({ notes: sortByUpdated([...s.notes, note]) }));
        return note;
      },

      // Bump updatedAt so the save is a fresh LWW write and the list re-sorts.
      // A no-op when the text didn't actually change, so an idle save doesn't
      // mark the note dirty or push to the cloud.
      updateText: (id, text) =>
        set((s) => {
          const target = s.notes.find((n) => n.id === id);
          if (!target || target.text === text) return s;
          const note: Note = {
            ...target,
            ...withTitle(text),
            text,
            updatedAt: Date.now(),
          };
          return { notes: sortByUpdated(s.notes.map((n) => (n.id === id ? note : n))) };
        }),

      remove: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      // Cloud metadata wins per row, but a locally cached body is preserved
      // for its id — otherwise every pull would blank the text of notes this
      // device had opened until they were re-fetched.
      replaceAll: (next) =>
        set((s) => {
          const localText = new Map<string, string>();
          for (const n of s.notes) if (n.text !== undefined) localText.set(n.id, n.text);
          const merged = (next ?? [])
            .map(normalizeNote)
            .filter((n): n is Note => n !== null)
            .map((n) => {
              const text = localText.get(n.id);
              return text !== undefined && n.text === undefined ? { ...n, text } : n;
            });
          return { notes: sortByUpdated(merged) };
        }),

      // Store the body fetched by NoteView. The sync layer wraps calls to this
      // in its hydration guard so it never queues a push.
      applyFetched: (note) =>
        set((s) => {
          const target = s.notes.find((n) => n.id === note.id);
          if (!target) return s;
          const next: Note = { ...target, ...note };
          return { notes: sortByUpdated(s.notes.map((n) => (n.id === note.id ? next : n))) };
        }),
    }),
    {
      name: 'studyplan_note',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<NoteState>;
        return {
          ...current,
          notes: sortByUpdated(
            (p.notes ?? []).map(normalizeNote).filter((n): n is Note => n !== null),
          ),
        };
      },
    },
  ),
);
