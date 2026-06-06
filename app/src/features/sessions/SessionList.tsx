import { useSessionStore } from '@/store/useSessionStore';
import { SessionCard } from './SessionCard';
import { EmptyState } from './EmptyState';
import type { Session } from '@/types';

export function SessionList({
  date,
  onOpenSession,
}: {
  date: string;
  onOpenSession: (session: Session) => void;
}) {
  const sessions = useSessionStore((s) => s.sessions[date]) ?? [];

  if (sessions.length === 0) {
    return (
      <div className="sessions">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="sessions">
      {sessions.map((s, idx) => (
        <div
          key={s.id}
          style={{ animationDelay: `${idx * 0.04}s` }}
        >
          <SessionCard date={date} session={s} onOpen={() => onOpenSession(s)} />
        </div>
      ))}
    </div>
  );
}
