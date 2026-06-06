import { useMemo } from 'react';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import { DeadlineCard } from './DeadlineCard';

export function DeadlinesView() {
  const deadlines = useDeadlineStore((s) => s.deadlines);

  const active = useMemo(() => deadlines.filter((d) => !d.done), [deadlines]);

  const sorted = useMemo(() => {
    return [...deadlines].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
  }, [deadlines]);

  return (
    <div className="deadlines" id="deadlinesSection">
      <div className="deadlines-head">
        <div className="deadlines-title">
          <h2>deadlines</h2>
          <span className="dt-count">{active.length}</span>
        </div>
      </div>

      <div className="deadlines-list">
        {deadlines.length === 0 ? (
          <div className="deadlines-empty">No deadlines yet — add one below.</div>
        ) : (
          sorted.map((d, idx) => (
            <div key={d.id} style={{ animationDelay: `${idx * 0.04}s` }}>
              <DeadlineCard deadline={d} origIdx={idx} />
            </div>
          ))
        )}
      </div>

      <DeadlineForm />
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useDeadlineStore as useDS } from '@/store/useDeadlineStore';
import { todayKey } from '@/lib/date';

function DeadlineForm() {
  const add = useDS((s) => s.add);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayKey());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || !date) return;
    add({ title: t, dueDate: date });
    setTitle('');
    setDate(todayKey());
  };

  return (
    <form className="deadline-form" onSubmit={submit}>
      <div className="field" style={{ flex: 2, minWidth: 140 }}>
        <label>title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. CS weekly assignment"
          required
        />
      </div>
      <div className="field field-date">
        <label>due date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>
      <div className="submit-cell">
        <button type="submit" className="submit-btn">+ add</button>
      </div>
    </form>
  );
}
