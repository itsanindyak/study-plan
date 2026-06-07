import { motion } from 'framer-motion';
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
    <motion.div
      className={'session' + (session.done ? ' done' : '')}
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
        className={'s-check' + (session.done ? ' checked' : '')}
        onClick={() => toggleDone(date, session.id)}
        aria-label={session.done ? 'mark as not done' : 'mark as done'}
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
        whileHover={{ scale: 1.2, rotate: 90 }}
        whileTap={{ scale: 0.8 }}
      >
        ✕
      </motion.button>
    </motion.div>
  );
}
