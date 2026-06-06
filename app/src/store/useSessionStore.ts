import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, Session, SessionsByDate } from '@/types';
import { newId } from '@/lib/id';
import { makeColorPicker } from '@/lib/color';

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
  toggleDone: (date: DateKey, id: string) => void;
  remove: (date: DateKey, id: string) => void;
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
          done: false,
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

      toggleDone: (date, id) =>
        set((s) => {
          const list = s.sessions[date];
          if (!list) return s;
          return {
            sessions: {
              ...s.sessions,
              [date]: list.map((x) =>
                x.id === id ? { ...x, done: !x.done, updatedAt: Date.now() } : x,
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
        set({ sessions: cloud });
      },
    }),
    {
      name: 'studyplan_sessions',
      partialize: (s) => ({ sessions: s.sessions, subjectColors: s.subjectColors }),
    },
  ),
);

// Helper: pull a snapshot of the current sessions map (used by sync).
export function snapshotSessions(): SessionsByDate {
  return useSessionStore.getState().sessions;
}
