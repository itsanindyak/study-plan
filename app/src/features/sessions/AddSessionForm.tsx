import { useState, type FormEvent } from 'react';
import { useSessionStore } from '@/store/useSessionStore';

export function AddSessionForm({ selectedDate }: { selectedDate: string }) {
  const add = useSessionStore((s) => s.add);
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState(60);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const t = topic.trim();
    if (!s || !t) return;
    add(selectedDate, { subject: s, topic: t, time, duration });
    setSubject('');
    setTopic('');
    setTime('09:00');
    setDuration(60);
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="add-form-row">
        <div className="field field-subject">
          <label>subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. mathematics"
            required
          />
        </div>
        <div className="field field-topic">
          <label>topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. integration by parts"
            required
          />
        </div>
      </div>
      <div className="add-form-row">
        <div className="field field-time">
          <label>start time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </div>
        <div className="field field-dur">
          <label>duration</label>
          <input
            type="number"
            min={5}
            max={600}
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
            required
          />
        </div>
        <div className="submit-cell">
          <button type="submit" className="submit-btn">+ add session</button>
        </div>
      </div>
    </form>
  );
}
