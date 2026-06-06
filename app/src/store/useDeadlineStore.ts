import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, Deadline } from '@/types';
import { newId } from '@/lib/id';

interface DeadlineState {
  deadlines: Deadline[];

  get: () => Deadline[];
  add: (input: { title: string; dueDate: DateKey }) => Deadline;
  toggle: (id: string) => void;
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
          done: false,
          createdAt: Date.now(),
        };
        set((s) => ({ deadlines: [...s.deadlines, d] }));
        return d;
      },

      toggle: (id) =>
        set((s) => ({
          deadlines: s.deadlines.map((d) => (d.id === id ? { ...d, done: !d.done } : d)),
        })),

      remove: (id) => set((s) => ({ deadlines: s.deadlines.filter((d) => d.id !== id) })),

      replaceAll: (next) => set({ deadlines: next }),

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
    { name: 'studyplan_deadlines' },
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
