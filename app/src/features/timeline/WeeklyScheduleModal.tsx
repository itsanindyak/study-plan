import { useEffect, useMemo, type CSSProperties } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { addDays, dateKey, DAYS_SHORT, MONTHS, isToday } from '@/lib/date';
import { assignLanes } from '@/lib/lanes';
import { timeToMin, minToTime, fmtTime12 } from '@/lib/time';
import { shade } from '@/lib/color';
import type { Session } from '@/types';

const TL_START = 6;
const TL_END = 30;
const HOUR_H = 48; // Compact height for weekly grid

export function WeeklyScheduleModal({
  open,
  weekStart,
  onClose,
  onOpenSession,
}: {
  open: boolean;
  weekStart: Date;
  onClose: () => void;
  onOpenSession: (dateKey: string, session: Session) => void;
}) {
  const sessions = useSessionStore((s) => s.sessions);

  // Close on Escape key press
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const daysOfCurrentWeek = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const weekLabel = useMemo(() => {
    const weekEnd = addDays(weekStart, 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    return sameMonth
      ? `${weekStart.getDate()} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
      : `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
  }, [weekStart]);

  if (!open) return null;

  const hours = Array.from({ length: TL_END - TL_START }, (_, i) => TL_START + i);

  return (
    <div
      className="popup-weekly-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="popup-weekly" role="dialog" aria-modal="true">
        <div className="popup-weekly-head">
          <div className="popup-weekly-title">
            <h2>Weekly Schedule</h2>
            <p>{weekLabel}</p>
          </div>
          <button className="popup-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="weekly-scroll-container">
          <div className="weekly-grid-header">
            <div className="weekly-time-header-cell" />
            {daysOfCurrentWeek.map((day, idx) => {
              const isDayToday = isToday(day);
              return (
                <div key={idx} className={`weekly-day-header-cell ${isDayToday ? 'today' : ''}`}>
                  <span className="wdh-name">{DAYS_SHORT[idx]}</span>
                  <span className="wdh-date">{day.getDate()}</span>
                </div>
              );
            })}
          </div>

          <div className="weekly-grid-body">
            <div className="weekly-time-col">
              {hours.map((h) => {
                const hour24 = h % 24;
                const label = hour24 % 12 === 0 ? 12 : hour24 % 12;
                const ampm = hour24 < 12 ? 'am' : 'pm';
                return (
                  <div key={h} className="weekly-time-label" style={{ height: `${HOUR_H}px` }}>
                    {label} {ampm}
                  </div>
                );
              })}
            </div>

            {daysOfCurrentWeek.map((day, dayIdx) => {
              const key = dateKey(day);
              const daySessions = sessions[key] ?? [];
              const lanes = assignLanes(daySessions);

              return (
                <div
                  key={dayIdx}
                  className="weekly-day-col"
                  style={{ height: `${hours.length * HOUR_H}px` }}
                >
                  {hours.map((h, hIdx) => (
                    <div
                      key={h}
                      className="weekly-grid-line"
                      style={{
                        position: 'absolute',
                        top: `${hIdx * HOUR_H}px`,
                        left: 0,
                        right: 0,
                        height: `${HOUR_H}px`,
                        borderTop: '1px solid var(--border)',
                      }}
                    />
                  ))}

                  {lanes.map(({ session, lane, count }) => {
                    const startM = timeToMin(session.time);
                    const dur = parseInt(String(session.duration)) || 60;
                    const top = ((startM - TL_START * 60) / 60) * HOUR_H;
                    const height = Math.max(26, (dur / 60) * HOUR_H - 3);

                    const blockStyle: CSSProperties = {
                      top: `${top}px`,
                      height: `${height}px`,
                      background: `linear-gradient(135deg, ${session.color}, ${shade(session.color, -18)})`,
                    };

                    if (count > 1) {
                      const leftPct = (lane / count) * 100;
                      const widthPct = (1 / count) * 100;
                      blockStyle.left = `calc(${leftPct}% + 2px)`;
                      blockStyle.width = `calc(${widthPct}% - 4px)`;
                    } else {
                      blockStyle.left = '2px';
                      blockStyle.width = 'calc(100% - 4px)';
                    }

                    return (
                      <div
                        key={session.id}
                        className={`weekly-block ${session.done ? 'done' : ''}`}
                        style={blockStyle}
                        onClick={() => onOpenSession(key, session)}
                        title={`${session.subject} — ${session.topic}\n${fmtTime12(session.time)} – ${fmtTime12(minToTime(startM + dur))}`}
                      >
                        <div className="weekly-block-subject">{session.subject}</div>
                        <div className="weekly-block-topic">{session.topic || session.subject}</div>
                        <div className="weekly-block-time">
                          {fmtTime12(session.time)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
