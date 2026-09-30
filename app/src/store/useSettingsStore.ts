import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CloudConfig } from '@/types';

const DEFAULT_WORKER_URL = 'https://study-plan.iankoley04.workers.dev';

interface SettingsState {
  token: string;
  workerUrl: string;
  theme: 'light' | 'dark';
  // true only after the saved token has passed a real /api/ping this session
  verified: boolean;
  setToken: (token: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setVerified: (verified: boolean) => void;
  clear: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      token: '',
      workerUrl: DEFAULT_WORKER_URL,
      theme: 'light',
      verified: false,
      // a token change invalidates verification — it must re-prove itself
      setToken: (token) => set({ token: token.trim(), verified: false }),
      setTheme: (theme) => set({ theme }),
      setVerified: (verified) => set({ verified }),
      clear: () => set({ token: '', verified: false }),
    }),
    {
      name: 'studyplan_config',
      // verified is session-scoped — never persisted
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
