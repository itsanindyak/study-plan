import { useState, type FormEvent } from 'react';
import { useSessionStore } from '@/store/useSessionStore';

export function AddSessionForm({ selectedDate }: { selectedDate: string }) {
  const add = useSessionStore((s) => s.add);
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');

  // Time states (Hours, Minutes, Period AM/PM)
  const [startHour, setStartHour] = useState('09');
  const [startMin, setStartMin] = useState('00');
  const [startPeriod, setStartPeriod] = useState('AM');

  // Duration states (Hours, Minutes)
  const [durHours, setDurHours] = useState<number>(1);
  const [durMins, setDurMins] = useState<number>(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const t = topic.trim();
    if (!s || !t) return;

    // Convert AM/PM format to 24h "HH:MM"
    let hourNum = parseInt(startHour, 10);
    if (startPeriod === 'PM' && hourNum < 12) {
      hourNum += 12;
    } else if (startPeriod === 'AM' && hourNum === 12) {
      hourNum = 0;
    }
    const time24 = `${String(hourNum).padStart(2, '0')}:${startMin}`;

    // Calculate total duration in minutes (ensure min 5 mins)
    const totalDuration = Math.max(5, durHours * 60 + durMins);

    add(selectedDate, { subject: s, topic: t, time: time24, duration: totalDuration });

    setSubject('');
    setTopic('');
    setStartHour('09');
    setStartMin('00');
    setStartPeriod('AM');
    setDurHours(1);
    setDurMins(0);
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
          <div className="time-select-group">
            <select
              value={startHour}
              onChange={(e) => setStartHour(e.target.value)}
              className="time-select"
            >
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="time-separator">:</span>
            <select
              value={startMin}
              onChange={(e) => setStartMin(e.target.value)}
              className="time-select"
            >
              {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              value={startPeriod}
              onChange={(e) => setStartPeriod(e.target.value)}
              className="time-select period-select"
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </div>
        <div className="field field-dur">
          <label>duration</label>
          <div className="dur-select-group">
            <input
              type="number"
              min={0}
              max={24}
              value={durHours}
              onChange={(e) => setDurHours(Math.max(0, parseInt(e.target.value) || 0))}
              placeholder="0"
              required
              className="dur-input"
            />
            <span className="dur-label">h</span>
            <input
              type="number"
              min={0}
              max={59}
              value={durMins}
              onChange={(e) => setDurMins(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
              placeholder="00"
              required
              className="dur-input"
            />
            <span className="dur-label">m</span>
          </div>
        </div>
        <div className="submit-cell">
          <button type="submit" className="submit-btn">+ add session</button>
        </div>
      </div>
    </form>
  );
}
