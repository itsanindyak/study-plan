import { useMemo } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { assignLanes } from '@/lib/lanes';
import { TimelineBlock } from './TimelineBlock';
import { NowLine } from './NowLine';
import type { Session } from '@/types';

const TL_START = 6;
const TL_END = 24;
const HOUR_H_FALLBACK = 56;

export function Timeline({
  date,
  onOpenSession,
}: {
  date: string;
  onOpenSession: (s: Session) => void;
}) {
  const sessions = useSessionStore((s) => s.sessions[date]) ?? [];
  const hourH = useMemo(() => {
    if (typeof window === 'undefined') return HOUR_H_FALLBACK;
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hour-h')) || HOUR_H_FALLBACK;
  }, []);

  const hours = useMemo(
    () => Array.from({ length: TL_END - TL_START }, (_, i) => TL_START + i),
    [],
  );

  const lanes = useMemo(() => assignLanes(sessions), [sessions]);

  return (
    <div className="timeline">
      {hours.map((h) => {
        const label = h % 12 === 0 ? 12 : h % 12;
        const ampm = h < 12 ? 'am' : 'pm';
        return (
          <div className="hour-row" key={h}>
            <div className="hour-label">{label} {ampm}</div>
            <div className="hour-cell" />
          </div>
        );
      })}
      {lanes.map(({ session, lane, count }) => (
        <TimelineBlock
          key={session.id}
          session={session}
          lane={lane}
          count={count}
          hourH={hourH}
          tlStart={TL_START}
          onOpen={() => onOpenSession(session)}
        />
      ))}
      <NowLine date={date} />
    </div>
  );
}
