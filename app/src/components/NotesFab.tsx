import { useNoteStore } from '@/store/useNoteStore';
import { goNotes } from '@/lib/useHashRoute';

// Floating notepad button, pinned bottom-right and visible on every scroll
// position. On the planner it opens the notepad; on the notes list it starts
// a fresh note. (Deliberately absent inside a note — a stray tap there could
// abandon an unsaved draft.)
export function NotesFab({ mode }: { mode: 'open' | 'new' }) {
  const add = useNoteStore((s) => s.add);

  const onClick = () => {
    if (mode === 'new') {
      const note = add('');
      goNotes(note.id);
    } else {
      goNotes();
    }
  };

  return (
    <button
      type="button"
      className="notes-fab"
      onClick={onClick}
      aria-label={mode === 'new' ? 'new note' : 'open notepad'}
      title={mode === 'new' ? 'new note' : 'open notepad'}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  );
}
