import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CloudConfig } from '@/types';

const DEFAULT_WORKER_URL = 'https://study-plan.iankoley04.workers.dev';

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
    { name: 'studyplan_config' },
  ),
);

export const selectIsConfigured = (s: SettingsState): boolean => s.token.length > 0;
export const selectCloudConfig = (s: SettingsState): CloudConfig => ({
  token: s.token,
  workerUrl: s.workerUrl,
});
