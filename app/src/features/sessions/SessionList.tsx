import { AnimatePresence, motion } from 'framer-motion';
import { useSessionStore } from '@/store/useSessionStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import { SessionCard } from './SessionCard';
import { EmptyState } from './EmptyState';
import { DeadlineBanner } from './DeadlineBanner';
import type { Session } from '@/types';

export function SessionList({
  date,
  onOpenSession,
}: {
  date: string;
  onOpenSession: (session: Session) => void;
}) {
  const sessions = useSessionStore((s) => s.sessions[date]) ?? [];
  const deadlines = useDeadlineStore((s) => s.deadlines);
  const todaysDeadlines = deadlines
    .filter((d) => d.dueDate === date)
    .sort((a, b) => Number(a.done) - Number(b.done));

  if (sessions.length === 0 && todaysDeadlines.length === 0) {
    return (
      <div className="sessions">
        <EmptyState />
      </div>
    );
  }

  return (
    <motion.div
      className="sessions"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
      }}
    >
      {todaysDeadlines.map((d) => (
        <DeadlineBanner key={d.id} deadline={d} />
      ))}
      <AnimatePresence mode="popLayout">
        {sessions.map((s) => (
          <SessionCard key={s.id} date={date} session={s} onOpen={() => onOpenSession(s)} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
