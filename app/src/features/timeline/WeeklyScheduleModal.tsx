import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import { addDays, dateKey, DAYS_SHORT, MONTHS, isToday } from '@/lib/date';
import { assignLanes } from '@/lib/lanes';
import { timeToMin, minToTime, fmtTime12 } from '@/lib/time';
import { statusGradient } from '@/lib/color';
import { STATUS_RANK } from '@/lib/status';
import { isBreak, breakTitle, BREAK_COLOR } from '@/lib/session';
import { useSubjectColorMap, normalize as normalizeName } from '@/lib/subjects';
import { DeadlineBanner } from '@/features/sessions/DeadlineBanner';
import { dateKeyFromTs, type DayDeadline } from '@/lib/deadlines';
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
  const deadlines = useDeadlineStore((s) => s.deadlines);
  // one subscription for every block on the week; a recolor rerenders all of them
  const colorMap = useSubjectColorMap();

  // Date-keyed buckets so each day header can show its own count and popup.
  // A done deadline also lands on the day it was completed when that day differs
  // from its due date, mirroring `deadlinesForDay` in SessionList.
  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, DayDeadline[]>();
    const push = (key: string, item: DayDeadline) => {
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    };
    for (const d of deadlines) {
      push(d.dueDate, { deadline: d, context: 'due' });
      if (d.status === 'done' && d.completedAt != null) {
        const ck = dateKeyFromTs(d.completedAt);
        if (ck !== d.dueDate) push(ck, { deadline: d, context: 'completion' });
      }
    }
    // pending first, resolved last — same ordering as SessionList
    for (const list of map.values()) {
      list.sort((a, b) => STATUS_RANK[a.deadline.status] - STATUS_RANK[b.deadline.status]);
    }
    return map;
  }, [deadlines]);

  // Fixed-positioned popup rather than an absolutely-positioned one: the grid
  // lives inside a scroll container, so a normal dropdown would be clipped.
  const [deadlinePop, setDeadlinePop] = useState<{ date: string; x: number; y: number } | null>(
    null,
  );
  const popRef = useRef<HTMLDivElement | null>(null);

  // Escape closes the deadline popup first, then the whole modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deadlinePop) setDeadlinePop(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, deadlinePop]);

  // Outside click closes the deadline popup
  useEffect(() => {
    if (!deadlinePop) return;
    const onMouse = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setDeadlinePop(null);
    };
    document.addEventListener('mousedown', onMouse);
    return () => document.removeEventListener('mousedown', onMouse);
  }, [deadlinePop]);

  const toggleDeadlinePop = (date: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (deadlinePop?.date === date) {
      setDeadlinePop(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    // keep the panel on screen when the day is near the right edge
    const width = 288;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setDeadlinePop({ date, x, y: r.bottom + 6 });
  };

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
              const key = dateKey(day);
              const dayDeadlines = deadlinesByDay.get(key) ?? [];
              return (
                <div key={idx} className={`weekly-day-header-cell ${isDayToday ? 'today' : ''}`}>
                  <span className="wdh-name">{DAYS_SHORT[idx]}</span>
                  <span className="wdh-date">{day.getDate()}</span>
                  {dayDeadlines.length > 0 && (
                    <button
                      type="button"
                      className={
                        'wdh-deadlines' +
                        (deadlinePop?.date === key ? ' open' : '') +
                        (dayDeadlines.some((x) => x.deadline.status === 'pending') ? ' has-pending' : '')
                      }
                      onClick={(e) => toggleDeadlinePop(key, e)}
                      aria-expanded={deadlinePop?.date === key}
                      aria-label={`${dayDeadlines.length} deadline${dayDeadlines.length === 1 ? '' : 's'}`}
                      title={`${dayDeadlines.length} deadline${dayDeadlines.length === 1 ? '' : 's'}`}
                    >
                      <span className="wdh-dl-dot" />
                      {dayDeadlines.length}
                    </button>
                  )}
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
                    const breakRow = isBreak(session);
                    const color = breakRow
                      ? BREAK_COLOR
                      : colorMap.get(normalizeName(session.subject)) ?? session.color;
                    const label = breakRow ? breakTitle(session) : session.topic || session.subject;

                    const blockStyle: CSSProperties = {
                      top: `${top}px`,
                      height: `${height}px`,
                      background: statusGradient(color, session.status),
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
                        className={`weekly-block${breakRow ? ' break' : ''}${
                          session.status === 'done' ? ' done' : ''
                        }${session.status === 'notdone' ? ' notdone' : ''}`}
                        style={blockStyle}
                        onClick={() => onOpenSession(key, session)}
                        title={`${breakRow ? 'break' : session.subject} — ${label}\n${fmtTime12(session.time)} – ${fmtTime12(minToTime(startM + dur))}`}
                      >
                        {!breakRow && <div className="weekly-block-subject">{session.subject}</div>}
                        <div className="weekly-block-topic">{label}</div>
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

      {deadlinePop && (
        <div
          className="deadline-pop"
          ref={popRef}
          style={{ left: deadlinePop.x, top: deadlinePop.y }}
          role="dialog"
          aria-label="deadlines for the day"
        >
          <div className="deadline-pop-head">
            <span className="deadline-pop-title">deadlines</span>
            <button
              type="button"
              className="deadline-pop-close"
              onClick={() => setDeadlinePop(null)}
              aria-label="close"
            >
              ✕
            </button>
          </div>
          <div className="deadline-pop-list">
            {(deadlinesByDay.get(deadlinePop.date) ?? []).map(({ deadline, context }) => (
              <DeadlineBanner key={deadline.id} deadline={deadline} context={context} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
