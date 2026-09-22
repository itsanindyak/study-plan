import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, RatingEntry, RatingsByDate, Session, SessionsByDate, TaskStatus } from '@/types';
import { newId } from '@/lib/id';
import { addDays, dateKey } from '@/lib/date';
import { pinnedDates } from '@/lib/cachePins';
import { normalizeSession } from '@/lib/status';
import { suggestColor } from '@/lib/subjects';
import { useSubjectStore } from '@/store/useSubjectStore';

interface SessionState {
  sessions: SessionsByDate;
  // day ratings (1–10), keyed by date. A null value is a locally-cleared
  // rating waiting to be flushed — the UI treats it as unrated.
  ratings: RatingsByDate;

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

  // rating actions
  setRating: (date: DateKey, value: number | null) => void;
  // adopt a post-merge rating without stamping (flush + on-demand loads call
  // this under the hydration guard so it never re-marks the date dirty).
  // undefined removes the entry (server has no rating for the day).
  adoptRating: (date: DateKey, entry: RatingEntry | undefined) => void;

  // cloud hydration
  hydrateAll: (cloud: SessionsByDate, cloudRatings?: RatingsByDate) => void;
  // incremental pull: replace only the changed days, drop server-deleted days.
  // cloudRatings covers only changed days (upsert semantics): a changed day
  // missing from it means the server has no rating, so the local one goes.
  hydrateChanged: (changed: SessionsByDate, removedDates: DateKey[], cloudRatings?: RatingsByDate) => void;
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

// Ratings are tiny (a few bytes per rated day) so the whole map persists —
// no cache window. Drop anything malformed (foreign cache, old shape) rather
// than flushing garbage. Null-valued entries are pending clears: keep them,
// the flush turns them into an explicit server-side clear.
function normalizeRatingEntry(e: unknown): RatingEntry | null {
  if (!e || typeof e !== 'object') return null;
  const r = e as { value?: unknown; updatedAt?: unknown };
  if (r.value !== null) {
    if (!Number.isInteger(r.value) || (r.value as number) < 1 || (r.value as number) > 10) {
      return null;
    }
  }
  const updatedAt = Number(r.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  return { value: r.value as number | null, updatedAt };
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      ratings: {},

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

      setRating: (date, value) =>
        set((s) => {
          const curr = s.ratings[date];
          // no-op when already there, so we don't stamp updatedAt or push to cloud
          if (curr && curr.value === value) return s;
          return {
            ratings: { ...s.ratings, [date]: { value, updatedAt: Date.now() } },
          };
        }),

      adoptRating: (date, entry) =>
        set((s) => {
          if (entry === undefined) {
            if (!(date in s.ratings)) return s;
            const ratings = { ...s.ratings };
            delete ratings[date];
            return { ratings };
          }
          return { ratings: { ...s.ratings, [date]: entry } };
        }),

      hydrateAll: (cloud, cloudRatings) => {
        const sessions: SessionsByDate = {};
        for (const [date, list] of Object.entries(cloud ?? {})) {
          sessions[date] = byStartTime(
            (list ?? []).map(normalizeSession).filter((s): s is Session => s !== null),
          );
        }
        const ratings: RatingsByDate = {};
        for (const [date, entry] of Object.entries(cloudRatings ?? {})) {
          const clean = normalizeRatingEntry(entry);
          if (clean && clean.value !== null) ratings[date] = clean;
        }
        set({ sessions, ratings });
      },

      hydrateChanged: (changed, removedDates, cloudRatings) => {
        set((s) => {
          const sessions = { ...s.sessions };
          for (const [date, list] of Object.entries(changed ?? {})) {
            sessions[date] = byStartTime(
              (list ?? []).map(normalizeSession).filter((x): x is Session => x !== null),
            );
          }
          const ratings = { ...s.ratings };
          for (const date of removedDates ?? []) {
            delete sessions[date];
            delete ratings[date];
          }
          if (cloudRatings) {
            for (const [date, entry] of Object.entries(cloudRatings)) {
              const clean = normalizeRatingEntry(entry);
              if (clean && clean.value !== null) ratings[date] = clean;
              else delete ratings[date];
            }
            // a changed day absent from the map has no server rating (the
            // worker always includes one when it has it), so the local one
            // was cleared elsewhere — drop it. Dirty dates never reach here:
            // the caller filters them first.
            for (const date of Object.keys(changed ?? {})) {
              if (!(date in cloudRatings)) delete ratings[date];
            }
          }
          return { sessions, ratings };
        });
      },
    }),
    {
      name: 'studyplan_sessions',
      partialize: (s) => ({ sessions: cacheWindow(s.sessions), ratings: s.ratings }),
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
        const ratings: RatingsByDate = {};
        for (const [date, entry] of Object.entries(p.ratings ?? {})) {
          const clean = normalizeRatingEntry(entry);
          if (clean) ratings[date] = clean;
        }
        return { ...current, sessions, ratings };
      },
    },
  ),
);

// Helper: pull a snapshot of the current sessions map (used by sync).
export function snapshotSessions(): SessionsByDate {
  return useSessionStore.getState().sessions;
}
