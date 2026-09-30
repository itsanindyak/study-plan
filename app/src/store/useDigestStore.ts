// Daily digest email settings — the config lives in the worker's KV, so this
// store only exists while cloud sync is configured. Without a token the modal
// shows a "connect cloud first" state instead.

import { create } from 'zustand';
import { kvClient } from '@/features/sync/kvClient';
import { selectCloudConfig, useSettingsStore } from '@/store/useSettingsStore';
import type { DigestConfig } from '@/types';

export const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  time: '07:00',
  enabled: true,
  tzOffsetMinutes: 330,
};

interface DigestState {
  config: DigestConfig;
  error: string | null;
  load: () => Promise<void>;
  save: (patch: Partial<DigestConfig>) => Promise<void>;
}

export const useDigestStore = create<DigestState>()((set, get) => ({
  config: DEFAULT_DIGEST_CONFIG,
  error: null,

  load: async () => {
    const cfg = selectCloudConfig(useSettingsStore.getState());
    if (!cfg.token) return;
    try {
      const remote = await kvClient.getDigestConfig(cfg);
      if (remote) set({ config: remote, error: null });
      // any non-throwing response means the token passed the worker's auth
      useSettingsStore.getState().setVerified(true);
    } catch (e) {
      useSettingsStore.getState().setVerified(false);
      set({ error: 'load failed: ' + (e instanceof Error ? e.message : e) });
    }
  },

  save: async (patch) => {
    const cfg = selectCloudConfig(useSettingsStore.getState());
    if (!cfg.token) return;
    // optimistic — the worker merges the patch server-side
    set({ config: { ...get().config, ...patch } });
    try {
      const saved = await kvClient.putDigestConfig(cfg, patch);
      if (saved) set({ config: saved, error: null });
      useSettingsStore.getState().setVerified(true);
    } catch (e) {
      useSettingsStore.getState().setVerified(false);
      set({ error: 'save failed: ' + (e instanceof Error ? e.message : e) });
    }
  },
}));

export function fmtTzOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}
