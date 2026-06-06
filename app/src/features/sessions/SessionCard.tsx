import { useSessionStore } from '@/store/useSessionStore';
import { fmtTime12, minToTime, timeToMin } from '@/lib/time';

export function SessionCard({
  date,
  session,
  onOpen,
}: {
  date: string;
  session: import('@/types').Session;
  onOpen: () => void;
}) {
  const toggleDone = useSessionStore((s) => s.toggleDone);
  const remove = useSessionStore((s) => s.remove);
  const dur = parseInt(String(session.duration)) || 0;
  const startM = timeToMin(session.time);
  const endM = startM + dur;

  return (
    <div className={'session' + (session.done ? ' done' : '')}>
      <div className="s-color" style={{ background: session.color }} />
      <button
        type="button"
        className={'s-check' + (session.done ? ' checked' : '')}
        onClick={() => toggleDone(date, session.id)}
        aria-label={session.done ? 'mark as not done' : 'mark as done'}
      />
      <div className="s-body" onClick={onOpen} role="button" tabIndex={0}>
        <div className="s-title">
          {session.subject}
          <span className="s-topic">— {session.topic}</span>
        </div>
        <div className="s-meta">
          <span>⏖ {fmtTime12(session.time)} – {fmtTime12(minToTime(endM))}</span>
          <span>■ {dur} min</span>
        </div>
      </div>
      <button
        type="button"
        className="s-del"
        onClick={() => remove(date, session.id)}
        aria-label="delete"
      >
        ✕
      </button>
    </div>
  );
}
