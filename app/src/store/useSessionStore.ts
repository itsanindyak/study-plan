import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, Session, SessionsByDate, TaskStatus } from '@/types';
import { newId } from '@/lib/id';
import { makeColorPicker } from '@/lib/color';
import { normalizeSession } from '@/lib/status';

interface SessionState {
  sessions: SessionsByDate;
  subjectColors: Record<string, string>;

  // selectors
  getByDate: (date: DateKey) => Session[];

  // actions
  add: (
    date: DateKey,
    input: { subject: string; topic: string; time: string; duration: number },
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
    input: { subject: string; topic: string; time: string; duration: number },
  ) => void;
  replaceForDate: (date: DateKey, list: Session[]) => void;

  // cloud hydration
  hydrateAll: (cloud: SessionsByDate) => void;
}

const colorPicker = makeColorPicker();

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      subjectColors: {},

      getByDate: (date) => get().sessions[date] ?? [],

      add: (date, input) => {
        const color = colorPicker.get(input.subject);
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
            [date]: [...(s.sessions[date] ?? []), session],
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
          const color = colorPicker.get(input.subject);
          return {
            sessions: {
              ...s.sessions,
              [date]: list.map((x) =>
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
          else sessions[date] = list;
          return { sessions };
        }),

      hydrateAll: (cloud) => {
        const sessions: SessionsByDate = {};
        for (const [date, list] of Object.entries(cloud ?? {})) {
          sessions[date] = (list ?? [])
            .map(normalizeSession)
            .filter((s): s is Session => s !== null);
        }
        set({ sessions });
      },
    }),
    {
      name: 'studyplan_sessions',
      partialize: (s) => ({ sessions: s.sessions, subjectColors: s.subjectColors }),
      // migrate legacy `done: boolean` records out of localStorage on rehydrate
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        const sessions: SessionsByDate = {};
        for (const [date, list] of Object.entries(p.sessions ?? {})) {
          sessions[date] = (list ?? [])
            .map(normalizeSession)
            .filter((s): s is Session => s !== null);
        }
        return { ...current, sessions, subjectColors: p.subjectColors ?? {} };
      },
    },
  ),
);

// Helper: pull a snapshot of the current sessions map (used by sync).
export function snapshotSessions(): SessionsByDate {
  return useSessionStore.getState().sessions;
}
