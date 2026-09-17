import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, Deadline, TaskStatus } from '@/types';
import { newId } from '@/lib/id';
import { normalizeDeadline } from '@/lib/status';

interface DeadlineState {
  deadlines: Deadline[];

  get: () => Deadline[];
  add: (input: { title: string; dueDate: DateKey }) => Deadline;
  setStatus: (id: string, status: TaskStatus) => void;
  remove: (id: string) => void;
  replaceAll: (next: Deadline[]) => void;

  // runs the 3-days-past auto-purge and returns the kept list + removed ids
  cleanup: () => { kept: Deadline[]; removedIds: string[] };
}

const DAY_MS = 86_400_000;

export const useDeadlineStore = create<DeadlineState>()(
  persist(
    (set, get) => ({
      deadlines: [],

      get: () => get().deadlines,

      add: (input) => {
        const d: Deadline = {
          id: newId(),
          title: input.title,
          dueDate: input.dueDate,
          source: 'manual',
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ deadlines: [...s.deadlines, d] }));
        return d;
      },

      setStatus: (id, status) =>
        set((s) => {
          const target = s.deadlines.find((d) => d.id === id);
          // no-op when already in the requested state (avoids redundant sync push)
          if (!target || target.status === status) return s;
          return {
            deadlines: s.deadlines.map((d) =>
              d.id === id
                ? {
                    ...d,
                    status,
                    completedAt: status === 'done' ? Date.now() : undefined,
                    updatedAt: Date.now(),
                  }
                : d,
            ),
          };
        }),

      remove: (id) => set((s) => ({ deadlines: s.deadlines.filter((d) => d.id !== id) })),

      replaceAll: (next) =>
        set({
          deadlines: (next ?? [])
            .map(normalizeDeadline)
            .filter((d): d is Deadline => d !== null),
        }),

      cleanup: () => {
        const now = new Date();
        const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
        const all = get().deadlines;
        const removedIds: string[] = [];
        const kept = all.filter((d) => {
          if (!d.dueDate) return true;
          const dd = new Date(d.dueDate + 'T00:00:00');
          if (dd < cutoff) {
            removedIds.push(d.id);
            return false;
          }
          return true;
        });
        if (removedIds.length) set({ deadlines: kept });
        return { kept, removedIds };
      },
    }),
    {
      name: 'studyplan_deadlines',
      // migrate legacy `done: boolean` records out of localStorage on rehydrate
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DeadlineState>;
        return {
          ...current,
          deadlines: (p.deadlines ?? [])
            .map(normalizeDeadline)
            .filter((d): d is Deadline => d !== null),
        };
      },
    },
  ),
);

export function daysUntil(dateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / DAY_MS);
}

// re-export for convenience
export type { Deadline } from '@/types';
