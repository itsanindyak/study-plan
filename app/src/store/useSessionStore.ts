import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, Session, SessionsByDate, TaskStatus } from '@/types';
import { newId } from '@/lib/id';
import { addDays, dateKey } from '@/lib/date';
import { pinnedDates } from '@/lib/cachePins';
import { normalizeSession } from '@/lib/status';
import { suggestColor } from '@/lib/subjects';
import { useSubjectStore } from '@/store/useSubjectStore';

interface SessionState {
  sessions: SessionsByDate;

  // selectors
  getByDate: (date: DateKey) => Session[];

  // actions
  add: (
    date: DateKey,
    input: { subject: string; topic: string; time: string; duration: number; color?: string },
  ) => Session;
  setStatus: (
    date: DateKey,
    id: string,
    status: TaskStatus,
    focusedSeconds?: number,
  ) => void;
  remove: (date: DateKey, id: string) => void;
  update: (
    date: DateKey,
    id: string,
    input: { subject: string; topic: string; time: string; duration: number; color?: string },
  ) => void;
  replaceForDate: (date: DateKey, list: Session[]) => void;

  // cloud hydration
  hydrateAll: (cloud: SessionsByDate) => void;
}

// localStorage keeps only recent days; the database keeps everything and older
// days are fetched on demand. Every persist writes one JSON string for the
// whole slice, so without a window each edit re-serialises the user's entire
// history and the ~5MB quota creeps closer.
export const CACHE_WINDOW_DAYS = 90;

// The worker stores each day sorted by start time, but a locally added row
// lands at the end until the next pull, which made the list look unsorted.
// Keep that invariant in the store so every consumer sees one order.
// Array#sort is stable, so sessions sharing a start time keep the order they
// were created in.
function byStartTime(list: Session[]): Session[] {
  return [...list].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

function cacheWindow(sessions: SessionsByDate): SessionsByDate {
  const cutoff = dateKey(addDays(new Date(), -CACHE_WINDOW_DAYS));
  const out: SessionsByDate = {};
  for (const [date, list] of Object.entries(sessions)) {
    // ISO date keys compare correctly as strings, so no parsing needed
    if (date >= cutoff || pinnedDates.has(date)) out[date] = list;
  }
  return out;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},

      getByDate: (date) => get().sessions[date] ?? [],

      add: (date, input) => {
        // Caller passes the catalog color it already knows; otherwise we
        // pull one from the palette. Sessions always store a concrete color
        // so a session can still render even if the catalog is empty
        // (bootstrapping) or the subject was later deleted.
        const color =
          input.color ?? suggestColor(useSubjectStore.getState().subjects);
        const session: Session = {
          id: newId(),
          subject: input.subject,
          topic: input.topic,
          time: input.time,
          duration: input.duration,
          color,
          status: 'pending',
          updatedAt: Date.now(),
        };
        set((s) => ({
          sessions: {
            ...s.sessions,
            [date]: byStartTime([...(s.sessions[date] ?? []), session]),
          },
        }));
        return session;
      },

      setStatus: (date, id, status, focusedSeconds) =>
        set((s) => {
          const list = s.sessions[date];
          if (!list) return s;
          const target = list.find((x) => x.id === id);
          // no-op when already there, so we don't stamp updatedAt or push to cloud
          if (!target || target.status === status) return s;
          return {
            sessions: {
              ...s.sessions,
              [date]: list.map((x) => {
                if (x.id !== id) return x;
                const next: Session = {
                  ...x,
                  status,
                  updatedAt: Date.now(),
                };
                // only stamp focusedSeconds on the path coming from focus mode;
                // leaving undefined when un-marking or from other entry points
                if (focusedSeconds !== undefined) {
                  next.focusedSeconds = focusedSeconds;
                }
                return next;
              }),
            },
          };
        }),

      update: (date, id, input) =>
        set((s) => {
          const list = s.sessions[date];
          if (!list) return s;
          const color =
            input.color ?? suggestColor(useSubjectStore.getState().subjects);
          return {
            sessions: {
              ...s.sessions,
              // editing the start time can move the row, so re-sort
              [date]: byStartTime(
                list.map((x) =>
                  x.id === id
                    ? {
                        ...x,
                        subject: input.subject,
                        topic: input.topic,
                        time: input.time,
                        duration: input.duration,
                        color,
                        updatedAt: Date.now(),
                      }
                    : x,
                ),
              ),
            },
          };
        }),

      remove: (date, id) =>
        set((s) => {
          const list = s.sessions[date];
          if (!list) return s;
          const next = list.filter((x) => x.id !== id);
          const sessions = { ...s.sessions };
          if (next.length === 0) delete sessions[date];
          else sessions[date] = next;
          return { sessions };
        }),

      replaceForDate: (date, list) =>
        set((s) => {
          const sessions = { ...s.sessions };
          if (list.length === 0) delete sessions[date];
          else sessions[date] = byStartTime(list);
          return { sessions };
        }),

      hydrateAll: (cloud) => {
        const sessions: SessionsByDate = {};
        for (const [date, list] of Object.entries(cloud ?? {})) {
          sessions[date] = byStartTime(
            (list ?? []).map(normalizeSession).filter((s): s is Session => s !== null),
          );
        }
        set({ sessions });
      },
    }),
    {
      name: 'studyplan_sessions',
      partialize: (s) => ({ sessions: cacheWindow(s.sessions) }),
      // migrate legacy `done: boolean` records out of localStorage on rehydrate
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        const sessions: SessionsByDate = {};
        for (const [date, list] of Object.entries(p.sessions ?? {})) {
          // a cache written before the sort invariant existed gets ordered here
          sessions[date] = byStartTime(
            (list ?? []).map(normalizeSession).filter((s): s is Session => s !== null),
          );
        }
        return { ...current, sessions };
      },
    },
  ),
);

// Helper: pull a snapshot of the current sessions map (used by sync).
export function snapshotSessions(): SessionsByDate {
  return useSessionStore.getState().sessions;
}
