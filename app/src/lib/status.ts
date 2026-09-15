import type { Deadline, Session, TaskStatus } from '@/types';

// legacy records (localStorage / KV written before the tri-state change)
// carry `done: boolean` instead of `status`. Normalization lives here so
// the stores, cloud hydration and the worker all agree on the mapping.
type LegacyStatus = { status?: unknown; done?: unknown };

const VALID: TaskStatus[] = ['pending', 'done', 'notdone'];

// pending sorts first, then resolved tasks, with not-done last
export const STATUS_RANK: Record<TaskStatus, number> = {
  pending: 0,
  done: 1,
  notdone: 2,
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '○ pending',
  done: '✓ completed',
  notdone: '✕ not completed',
};

export function normalizeStatus(rec: LegacyStatus | null | undefined): TaskStatus {
  const s = rec?.status;
  if (typeof s === 'string' && (VALID as string[]).includes(s)) return s as TaskStatus;
  // legacy: done:true was completed, done:false was simply not-yet-done
  return rec?.done === true ? 'done' : 'pending';
}

// pressing the button for the status a task already has clears it back to pending
export function nextStatus(current: TaskStatus, pressed: 'done' | 'notdone'): TaskStatus {
  return current === pressed ? 'pending' : pressed;
}

export function isDone(rec: { status: TaskStatus }): boolean {
  return rec.status === 'done';
}

export function normalizeSession(
  raw: (Partial<Session> & LegacyStatus) | null | undefined,
): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const { done: _legacyDone, ...rest } = raw;
  return { ...(rest as Session), status: normalizeStatus(raw) };
}

export function normalizeDeadline(
  raw: (Partial<Deadline> & LegacyStatus) | null | undefined,
): Deadline | null {
  if (!raw || typeof raw !== 'object') return null;
  const { done: _legacyDone, ...rest } = raw;
  return { ...(rest as Deadline), status: normalizeStatus(raw) };
}
