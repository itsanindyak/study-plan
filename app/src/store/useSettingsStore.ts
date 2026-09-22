import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CloudConfig } from '@/types';

const DEFAULT_WORKER_URL = 'https://study-worker.anindya.online';

interface SettingsState {
  token: string;
  workerUrl: string;
  setToken: (token: string) => void;
  clear: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      token: '',
      workerUrl: DEFAULT_WORKER_URL,
      setToken: (token) => set({ token: token.trim() }),
      clear: () => set({ token: '' }),
    }),
    {
      name: 'studyplan_config',
      partialize: (state) => ({ token: state.token }),
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
