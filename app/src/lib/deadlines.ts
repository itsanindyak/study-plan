import type { DateKey, Deadline } from '@/types';
import { dateKey } from '@/lib/date';
import { STATUS_RANK } from '@/lib/status';

// How a deadline is placed on a given day:
//  • 'due'        — the day matches the deadline's own dueDate
//  • 'completion' — the deadline was completed on this day, which differs from
//                   its dueDate, so it also surfaces on the day it was done
export type DeadlineDayContext = 'due' | 'completion';

export interface DayDeadline {
  deadline: Deadline;
  context: DeadlineDayContext;
}

/** Local-date DateKey for an epoch timestamp (completedAt is ms epoch). */
export function dateKeyFromTs(ts: number): DateKey {
  return dateKey(new Date(ts));
}

/** Which day (if any) this deadline belongs to for `date`. */
export function deadlineContextForDay(
  d: Deadline,
  date: DateKey,
): DeadlineDayContext | null {
  if (d.dueDate === date) return 'due';
  if (d.status === 'done' && d.completedAt != null) {
    const completedOn = dateKeyFromTs(d.completedAt);
    // only add the completion day when it's a different day than the due date
    if (completedOn === date && completedOn !== d.dueDate) return 'completion';
  }
  return null;
}

/** Deadlines to show on `date`: those due that day, plus those completed that
 *  day (when completed on a day other than their due date). Pending first. */
export function deadlinesForDay(all: Deadline[], date: DateKey): DayDeadline[] {
  const out: DayDeadline[] = [];
  for (const d of all) {
    const context = deadlineContextForDay(d, date);
    if (context) out.push({ deadline: d, context });
  }
  return out.sort(
    (a, b) =>
      STATUS_RANK[a.deadline.status] - STATUS_RANK[b.deadline.status] ||
      (a.deadline.dueDate || '').localeCompare(b.deadline.dueDate || ''),
  );
}
