import { motion } from 'framer-motion';
import { useSessionStore } from '@/store/useSessionStore';
import { fmtTime12, minToTime, timeToMin } from '@/lib/time';
import { nextStatus } from '@/lib/status';
import type { Session } from '@/types';

export function SessionCard({
  date,
  session,
  onOpen,
}: {
  date: string;
  session: Session;
  onOpen: () => void;
}) {
  const setStatus = useSessionStore((s) => s.setStatus);
  const remove = useSessionStore((s) => s.remove);
  const dur = parseInt(String(session.duration)) || 0;
  const startM = timeToMin(session.time);
  const endM = startM + dur;

  const className =
    'session' +
    (session.status === 'done' ? ' done' : '') +
    (session.status === 'notdone' ? ' notdone' : '');

  return (
    <motion.div
      className={className}
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="s-color" style={{ background: session.color }} />
      <motion.button
        type="button"
        className={'s-check' + (session.status === 'done' ? ' checked' : '')}
        onClick={() => setStatus(date, session.id, nextStatus(session.status, 'done'))}
        aria-label="mark as done"
        aria-pressed={session.status === 'done'}
        whileTap={{ scale: 0.85 }}
      />
      <motion.button
        type="button"
        className={'s-notdone' + (session.status === 'notdone' ? ' active' : '')}
        onClick={() => setStatus(date, session.id, nextStatus(session.status, 'notdone'))}
        aria-label="mark as not done"
        aria-pressed={session.status === 'notdone'}
        whileTap={{ scale: 0.85 }}
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
      <motion.button
        type="button"
        className="s-del"
        onClick={() => remove(date, session.id)}
        aria-label="delete"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.85 }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </motion.button>
    </motion.div>
  );
}
