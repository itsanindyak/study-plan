import type { Session } from '@/types';
import { timeToMin } from './time';

export interface LaneAssignment {
  session: Session;
  lane: number;
  count: number;
}

/**
 * Greedy lane assignment for overlapping sessions.
 * Returns each session with its lane index and the total lane count
 * so callers can compute the column width.
 */
export function assignLanes(sessions: Session[]): LaneAssignment[] {
  const sorted = [...sessions].sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  const lanes: { start: number; end: number; session: Session }[][] = [];
  const result: LaneAssignment[] = [];
  sorted.forEach((s) => {
    const start = timeToMin(s.time);
    const dur = parseInt(String(s.duration)) || 60;
    const end = start + dur;
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const last = lanes[i][lanes[i].length - 1];
      if (last.end <= start) {
        lanes[i].push({ start, end, session: s });
        result.push({ session: s, lane: i, count: 0 });
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([{ start, end, session: s }]);
      result.push({ session: s, lane: lanes.length - 1, count: 0 });
    }
  });
  const maxLane = lanes.length;
  result.forEach((r) => (r.count = maxLane));
  return result;
}
