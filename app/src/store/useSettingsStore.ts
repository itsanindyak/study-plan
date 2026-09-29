import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CloudConfig } from '@/types';

const DEFAULT_WORKER_URL = 'https://study-plan.iankoley04.workers.dev';

interface SettingsState {
  token: string;
  workerUrl: string;
  theme: 'light' | 'dark';
  setToken: (token: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  clear: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      token: '',
      workerUrl: DEFAULT_WORKER_URL,
      theme: 'light',
      setToken: (token) => set({ token: token.trim() }),
      setTheme: (theme) => set({ theme }),
      clear: () => set({ token: '' }),
    }),
    {
      name: 'studyplan_config',
      partialize: (state) => ({ token: state.token, theme: state.theme }),
      merge: (persisted: unknown, current: SettingsState): SettingsState => ({
        ...current,
        ...(persisted as Partial<SettingsState>),
        workerUrl: DEFAULT_WORKER_URL,
      }),
    },
  ),
);

export const selectIsConfigured = (s: SettingsState): boolean => s.token.length > 0;
export const selectCloudConfig = (s: SettingsState): CloudConfig => ({
  token: s.token,
  workerUrl: s.workerUrl,
});
