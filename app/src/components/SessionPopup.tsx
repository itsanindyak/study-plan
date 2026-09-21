import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { fmtTime12, minToTime, timeToMin, fmtDuration } from '@/lib/time';
import { statusGradient } from '@/lib/color';
import { useSubjectColorMap, normalize as normalizeName } from '@/lib/subjects';
import { SubjectPicker } from '@/features/sessions/SubjectPicker';
import { nextStatus, STATUS_LABEL } from '@/lib/status';
import type { Session } from '@/types';

export function SessionPopup({
  date,
  session,
  onClose,
}: {
  date: string;
  session: Session;
  onClose: () => void;
}) {
  const setStatus = useSessionStore((s) => s.setStatus);
  const remove = useSessionStore((s) => s.remove);
  const update = useSessionStore((s) => s.update);
  const colorMap = useSubjectColorMap();
  const color = colorMap.get(normalizeName(session.subject)) ?? session.color;

  const [isEditing, setIsEditing] = useState(false);
  const [subject, setSubject] = useState(session.subject);
  const [topic, setTopic] = useState(session.topic || '');

  // Parse time
  const [h24, m24] = session.time.split(':').map(Number);
  const isPM = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const [startHour, setStartHour] = useState(String(h12).padStart(2, '0'));
  const [startMin, setStartMin] = useState(String(m24 || 0).padStart(2, '0'));
  const [startPeriod, setStartPeriod] = useState(isPM ? 'PM' : 'AM');

  // Duration
  const durH = Math.floor(session.duration / 60);
  const durM = session.duration % 60;
  const [durHours, setDurHours] = useState<number>(durH);
  const [durMins, setDurMins] = useState<number>(durM);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reset fields when prop session updates or when editing starts/stops
  useEffect(() => {
    if (!isEditing) {
      setSubject(session.subject);
      setTopic(session.topic || '');
      const [h24, m24] = session.time.split(':').map(Number);
      const isPM = h24 >= 12;
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      setStartHour(String(h12).padStart(2, '0'));
      setStartMin(String(m24 || 0).padStart(2, '0'));
      setStartPeriod(isPM ? 'PM' : 'AM');
      setDurHours(Math.floor(session.duration / 60));
      setDurMins(session.duration % 60);
    }
  }, [session, isEditing]);

  const dur = parseInt(String(session.duration)) || 0;
  const startM = timeToMin(session.time);
  const endM = startM + dur;

  const onMark = (pressed: 'done' | 'notdone') => () => {
    setStatus(date, session.id, nextStatus(session.status, pressed));
    onClose();
  };
  const onDelete = () => {
    remove(date, session.id);
    onClose();
  };

  const onSave = () => {
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

    // Duration in minutes
    const totalDuration = Math.max(5, durHours * 60 + durMins);

    update(date, session.id, {
      subject: s,
      topic: t,
      time: time24,
      duration: totalDuration,
    });
    onClose();
  };

  return (
    <motion.div
      className="popup-backdrop"
      style={{ zIndex: 250 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="popup"
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        <div className="popup-head">
          <div
            className="popup-swatch"
            style={{ background: statusGradient(color, session.status) }}
          />
          {!isEditing ? (
            <div className="popup-title">
              <h3>{session.topic || session.subject}</h3>
              <div className="pt-sub">{session.subject}</div>
            </div>
          ) : (
            <div className="popup-title" style={{ marginRight: '0.5rem' }}>
              <div className="popup-edit-field">
                <label>subject</label>
                <SubjectPicker value={subject} onChange={setSubject} />
              </div>
              <div className="popup-edit-field" style={{ marginBottom: 0 }}>
                <label>topic</label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="popup-input"
                  required
                />
              </div>
            </div>
          )}
          <button className="popup-close" onClick={onClose} aria-label="close">✕</button>
        </div>

        {!isEditing ? (
          <>
            <div className="popup-row">
              <span className="pr-label">start</span>
              <span className="pr-value">{fmtTime12(session.time)}</span>
            </div>
            <div className="popup-row">
              <span className="pr-label">end</span>
              <span className="pr-value">{fmtTime12(minToTime(endM))}</span>
            </div>
            <div className="popup-row">
              <span className="pr-label">duration</span>
              <span className="pr-value">{fmtDuration(dur)} ({dur} min)</span>
            </div>
            <div className="popup-row">
              <span className="pr-label">status</span>
              <span className="pr-value">{STATUS_LABEL[session.status]}</span>
            </div>
            <div className="popup-hex">
              <div className="ph-dot" style={{ background: color }} />
              <span>{color.toUpperCase()}</span>
            </div>
            <div className="popup-actions">
              <button
                className={'pa-done' + (session.status === 'done' ? ' active' : '')}
                onClick={onMark('done')}
                aria-pressed={session.status === 'done'}
                title={session.status === 'done' ? 'Click to clear back to pending' : 'Mark as done'}
              >
                ✓ done
              </button>
              <button
                className={'pa-notdone' + (session.status === 'notdone' ? ' active' : '')}
                onClick={onMark('notdone')}
                aria-pressed={session.status === 'notdone'}
                title={
                  session.status === 'notdone'
                    ? 'Click to clear back to pending'
                    : 'Mark as not done'
                }
              >
                ✕ not done
              </button>
              <button className="pa-edit" onClick={() => setIsEditing(true)}>edit</button>
              <button className="pa-del" onClick={onDelete}>delete</button>
            </div>
          </>
        ) : (
          <>
            <div className="popup-row edit-row">
              <span className="pr-label">start time</span>
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
            <div className="popup-row edit-row">
              <span className="pr-label">duration</span>
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
            <div className="popup-actions">
              <button className="pa-save" onClick={onSave}>save</button>
              <button className="pa-cancel" onClick={() => setIsEditing(false)}>cancel</button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
