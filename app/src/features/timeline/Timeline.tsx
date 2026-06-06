import { useEffect, useMemo, useRef } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { assignLanes } from '@/lib/lanes';
import { dateKey } from '@/lib/date';
import { TimelineBlock } from './TimelineBlock';
import { NowLine } from './NowLine';
import type { Session } from '@/types';

const TL_START = 6;
const TL_END = 30;
const HOUR_H_FALLBACK = 56;

export function Timeline({
  date,
  onOpenSession,
}: {
  date: string;
  onOpenSession: (s: Session) => void;
}) {
  const sessions = useSessionStore((s) => s.sessions[date]) ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  const hourH = useMemo(() => {
    if (typeof window === 'undefined') return HOUR_H_FALLBACK;
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hour-h')) || HOUR_H_FALLBACK;
  }, []);

  const hours = useMemo(
    () => Array.from({ length: TL_END - TL_START }, (_, i) => TL_START + i),
    [],
  );

  const lanes = useMemo(() => assignLanes(sessions), [sessions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      const now = new Date();
      const timelineDate = new Date(now);
      if (timelineDate.getHours() < 6) {
        timelineDate.setDate(timelineDate.getDate() - 1);
      }
      const timelineDateKey = dateKey(timelineDate);

      if (date === timelineDateKey) {
        let nowM = now.getHours() * 60 + now.getMinutes();
        if (now.getHours() < 6) {
          nowM += 24 * 60;
        }
        if (nowM >= TL_START * 60 && nowM < TL_END * 60) {
          const top = ((nowM - TL_START * 60) / 60) * hourH;
          const container = containerRef.current;
          container.scrollTo({
            top: top - container.clientHeight / 2,
            behavior: 'smooth',
          });
        }
      } else {
        containerRef.current.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [date, hourH]);

  return (
    <div className="timeline" ref={containerRef}>
      {hours.map((h) => {
        const hour24 = h % 24;
        const label = hour24 % 12 === 0 ? 12 : hour24 % 12;
        const ampm = hour24 < 12 ? 'am' : 'pm';
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
