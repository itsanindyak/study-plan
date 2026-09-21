import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Subject } from '@/types';
import { newId } from '@/lib/id';
import { normalizeSubject } from '@/lib/status';
import { normalize as normalizeName } from '@/lib/subjects';
import { useSessionStore } from '@/store/useSessionStore';

interface SubjectState {
  subjects: Subject[];

  get: () => Subject[];
  add: (input: { name: string; color: string }) => Subject | null;
  rename: (id: string, name: string) => boolean;
  recolor: (id: string, color: string) => boolean;
  remove: (id: string) => void;
  replaceAll: (next: Subject[]) => void;
}

function byNameAsc(a: Subject, b: Subject): number {
  return a.name.localeCompare(b.name);
}

// A name already in use (case-insensitive) means the caller is editing an
// existing entry, not creating a duplicate.
function nameTaken(subjects: readonly Subject[], name: string, exceptId?: string): boolean {
  const n = normalizeName(name);
  return subjects.some((s) => normalizeName(s.name) === n && s.id !== exceptId);
}

export const useSubjectStore = create<SubjectState>()(
  persist(
    (set, get) => ({
      subjects: [],

      get: () => get().subjects,

      add: (input) => {
        const name = input.name.trim();
        if (!name) return null;
        const existing = get().subjects;
        if (nameTaken(existing, name)) return null;
        const s: Subject = {
          id: newId(),
          name,
          color: input.color,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set({ subjects: [...existing, s].sort(byNameAsc) });
        return s;
      },

      rename: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        const existing = get().subjects;
        if (nameTaken(existing, trimmed, id)) return false;
        const target = existing.find((s) => s.id === id);
        if (!target || target.name === trimmed) return false;
        set({
          subjects: existing
            .map((s) =>
              s.id === id ? { ...s, name: trimmed, updatedAt: Date.now() } : s,
            )
            .sort(byNameAsc),
        });
        return true;
      },

      recolor: (id, color) => {
        const existing = get().subjects;
        const target = existing.find((s) => s.id === id);
        if (!target || target.color.toLowerCase() === color.toLowerCase()) return false;
        set({
          subjects: existing.map((s) =>
            s.id === id ? { ...s, color, updatedAt: Date.now() } : s,
          ),
        });
        return true;
      },

      remove: (id) =>
        set((s) => ({ subjects: s.subjects.filter((x) => x.id !== id) })),

      replaceAll: (next) =>
        set({
          subjects: (next ?? [])
            .map(normalizeSubject)
            .filter((s): s is Subject => s !== null)
            .sort(byNameAsc),
        }),
    }),
    {
      name: 'studyplan_subjects',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SubjectState>;
        return {
          ...current,
          subjects: (p.subjects ?? [])
            .map(normalizeSubject)
            .filter((s): s is Subject => s !== null)
            .sort(byNameAsc),
        };
      },
    },
  ),
);

// One-time bootstrap of subjects from whatever's already in the sessions cache,
// so the user doesn't open Settings to an empty list. The flag prevents us
// from re-seeding a catalog the user has intentionally emptied.
const SEED_FLAG = 'studyplan_subjects_seeded';

export async function seedSubjectsFromSessions(): Promise<boolean> {
  if (localStorage.getItem(SEED_FLAG)) return false;
  const subjects = useSubjectStore.getState().subjects;
  if (subjects.length > 0) {
    localStorage.setItem(SEED_FLAG, '1');
    return false;
  }
  // useSessionStore is imported statically above; access via getState() to
  // avoid pulling its hooks into this store's module graph at load time.
  const sessions = useSessionStore.getState().sessions;
  const byNorm = new Map<string, Subject>();
  for (const list of Object.values(sessions)) {
    for (const s of list) {
      const n = normalizeName(s.subject);
      if (!n) continue;
      if (!byNorm.has(n)) {
        byNorm.set(n, {
          id: newId(),
          name: s.subject,
          color: s.color,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
  }
  if (byNorm.size === 0) {
    localStorage.setItem(SEED_FLAG, '1');
    return false;
  }
  useSubjectStore.getState().replaceAll([...byNorm.values()]);
  localStorage.setItem(SEED_FLAG, '1');
  return true;
}

