// Subject picker: a dropdown menu listing catalog subjects. Picking is the
// only thing it does — new subjects are created in Settings, not here.
// Used by both AddSessionForm and SessionPopup's edit form.

import { useEffect, useRef, useState } from 'react';
import { useSubjectStore } from '@/store/useSubjectStore';

export function SubjectPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const subjects = useSubjectStore((s) => s.subjects);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selected = subjects.find((s) => s.name === value);

  // outside click + Escape close the panel
  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="subject-menu" ref={containerRef}>
      <button
        type="button"
        className={'subject-menu-trigger' + (selected ? ' filled' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <>
            <span className="subject-menu-swatch" style={{ background: selected.color }} />
            <span className="subject-menu-name">{selected.name}</span>
          </>
        ) : (
          <span className="subject-menu-placeholder">select subject…</span>
        )}
        <span className="subject-menu-caret">▾</span>
      </button>

      {open && (
        <div className="subject-menu-panel" role="listbox">
          {subjects.length === 0 ? (
            <div className="subject-menu-empty">
              no subjects yet — add them in settings → subjects
            </div>
          ) : (
            subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={value === s.name}
                className={'subject-menu-item' + (value === s.name ? ' selected' : '')}
                onClick={() => {
                  onChange(s.name);
                  setOpen(false);
                }}
              >
                <span className="subject-menu-swatch" style={{ background: s.color }} />
                <span className="subject-menu-name">{s.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
