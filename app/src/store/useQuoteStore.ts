import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Quote } from '@/types';

interface QuoteState {
  text: string;
  updatedAt: number;
  setText: (text: string) => void;
  hydrate: (q: Quote | null) => void;
}

export const useQuoteStore = create<QuoteState>()(
  persist(
    (set, get) => ({
      text: '',
      updatedAt: 0,
      setText: (text) => set({ text: text.trim(), updatedAt: Date.now() }),
      // last-write-wins against a remote copy; null (server has no quote)
      // is a no-op so an owed local edit isn't dropped by a sparse pull
      hydrate: (q) => {
        if (!q) return;
        if (q.updatedAt >= get().updatedAt) set({ text: q.text, updatedAt: q.updatedAt });
      },
    }),
    {
      name: 'studyplan_quote',
      partialize: (state) => ({ text: state.text, updatedAt: state.updatedAt }),
    },
  ),
);
