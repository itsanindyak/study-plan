// Reactive sync orchestrator.
//
// • On mount: pulls the latest sessions + deadlines from KV and merges
//   them into the local stores (per-date LWW for sessions, replace for
//   deadlines). Failures fall back to the localStorage cache.
// • Subscribes to both stores to track which items changed locally;
//   debounces a flush of those items to KV at +800ms. Retries on
//   failure at +4s.
// • On tab visibilitychange → visible: re-pulls from KV and merges.
// • Exposes the current sync state via a small subscription that
//   components like <SyncPill/> can read.

import { useEffect, useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import type { Session, Deadline, SyncState } from '@/types';
import { kvClient } from './kvClient';

// ─────── pill state (module-level so any component can subscribe) ───────
type Listener = () => void;
interface PillSnapshot {
  state: SyncState;
  label: string;
}
let pillState: SyncState = 'offline';
let pillLabel = 'offline';
let lastSyncAt: number | null = null;
let cachedSnapshot: PillSnapshot = { state: pillState, label: pillLabel };
const listeners = new Set<Listener>();

function rebuildSnapshot(): PillSnapshot {
  if (cachedSnapshot.state !== pillState || cachedSnapshot.label !== pillLabel) {
    cachedSnapshot = { state: pillState, label: pillLabel };
  }
  return cachedSnapshot;
}
function emit() {
  rebuildSnapshot();
  for (const l of listeners) l();
}
function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function setPill(state: SyncState, label: string) {
  pillState = state;
  pillLabel = label;
  emit();
}
function refreshPill() {
  if (!useSettingsStore.getState().token) {
    setPill('offline', 'offline');
    return;
  }
  if (lastSyncAt == null) {
    setPill('synced', 'cloud');
    return;
  }
  const ago = Math.round((Date.now() - lastSyncAt) / 1000);
  const label = ago < 5 ? 'synced' : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  setPill('synced', label);
}

export function useSyncPill(): PillSnapshot {
  return useSyncExternalStore(subscribe, rebuildSnapshot, rebuildSnapshot);
}

// ─────── boot / focus refresh ───────
export async function pullFromCloud() {
  const cfg = {
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  };
  if (!cfg.token) return false;
  try {
    setPill('syncing', 'syncing…');
    const [cloudSessions, cloudDeadlines] = await Promise.all([
      kvClient.getAllSessions(cfg),
      kvClient.getDeadlines(cfg),
    ]);

    // Mark stores as hydrating so the dirty tracker ignores this write.
    hydrationDepth++;

    try {
      if (cloudSessions) useSessionStore.getState().hydrateAll(cloudSessions);
      if (cloudDeadlines) {
        // Auto-purge local entries >3 days past before replacing.
        const { kept, removedIds } = useDeadlineStore.getState().cleanup();
        if (removedIds.length) {
          // best-effort delete on cloud; ignore errors
          await Promise.allSettled(removedIds.map((id) => kvClient.deleteDeadline(cfg, id)));
        }
        // For the replace: take cloud as truth. Any local items missing from
        // cloud are presumed deleted elsewhere.
        useDeadlineStore.getState().replaceAll(cloudDeadlines);
        // `kept` is just for the cleanup call; not used after this point.
        void kept;
      }
    } finally {
      hydrationDepth--;
    }

    lastSyncAt = Date.now();
    refreshPill();
    return true;
  } catch (err) {
    console.warn('cloud pull failed:', err);
    setPill('error', 'sync error');
    return false;
  }
}

// ─────── dirty tracking + debounced flush ───────
const dirtyDates = new Set<string>();
const dirtyDeadlines = new Map<string, 'put' | 'delete'>();
let hydrationDepth = 0;
let pending = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function isHydrating() {
  return hydrationDepth > 0;
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(flushDirty, 800);
}

async function flushDirty() {
  syncTimer = null;
  if (pending) return;
  if (!useSettingsStore.getState().token) return;
  if (dirtyDates.size === 0 && dirtyDeadlines.size === 0) return;

  pending = true;
  setPill('syncing', 'syncing…');

  const cfg = {
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  };
  const dates = Array.from(dirtyDates);
  dirtyDates.clear();
  const dls = Array.from(dirtyDeadlines.entries());
  dirtyDeadlines.clear();

  const failedDates = new Set<string>();
  const failedDls = new Map<string, 'put' | 'delete'>();

  try {
    for (const date of dates) {
      try {
        const list: Session[] = useSessionStore.getState().sessions[date] ?? [];
        if (list.length === 0) {
          await kvClient.deleteSessionDate(cfg, date);
        } else {
          await kvClient.putSession(cfg, date, list);
        }
      } catch (err) {
        console.warn('PUT session ' + date + ' failed:', err);
        failedDates.add(date);
      }
    }

    for (const [id, op] of dls) {
      try {
        if (op === 'delete') {
          await kvClient.deleteDeadline(cfg, id);
        } else {
          const d: Deadline | undefined = useDeadlineStore
            .getState()
            .deadlines.find((x) => x.id === id);
          if (d) await kvClient.putDeadline(cfg, d);
        }
      } catch (err) {
        console.warn(op + ' deadline ' + id + ' failed:', err);
        failedDls.set(id, op);
      }
    }

    if (failedDates.size || failedDls.size) {
      for (const d of failedDates) dirtyDates.add(d);
      for (const [id, op] of failedDls) dirtyDeadlines.set(id, op);
      retryTimer = setTimeout(flushDirty, 4000);
      setPill('error', 'sync error');
    } else {
      lastSyncAt = Date.now();
      refreshPill();
    }
  } finally {
    pending = false;
  }
}

// ─────── store subscriptions ───────
let prevSessionsRef: Record<string, Session[]> = {};
let prevDeadlinesRef: Deadline[] = [];

function diffSessions(curr: Record<string, Session[]>) {
  const prev = prevSessionsRef;
  const keys = new Set([...Object.keys(curr), ...Object.keys(prev)]);
  for (const k of keys) {
    if (curr[k] !== prev[k]) dirtyDates.add(k);
  }
  prevSessionsRef = curr;
}

function diffDeadlines(curr: Deadline[]) {
  const prev = prevDeadlinesRef;
  if (curr === prev) return;
  const prevById = new Map(prev.map((d) => [d.id, d] as const));
  for (const d of curr) {
    const before = prevById.get(d.id);
    if (!before || before !== d) dirtyDeadlines.set(d.id, 'put');
  }
  const currIds = new Set(curr.map((d) => d.id));
  for (const d of prev) {
    if (!currIds.has(d.id)) dirtyDeadlines.set(d.id, 'delete');
  }
  prevDeadlinesRef = curr;
}

// ─────── main hook ───────
export function useCloudSync() {
  const token = useSettingsStore((s) => s.token);

  // boot + subscriptions + focus refresh. Re-runs when token flips.
  useEffect(() => {
    if (!token) {
      setPill('offline', 'offline');
      return;
    }

    // seed refs with current state so first change correctly diffs
    prevSessionsRef = useSessionStore.getState().sessions;
    prevDeadlinesRef = useDeadlineStore.getState().deadlines;

    // boot
    void pullFromCloud();

    // subscribe
    const unsubSessions = useSessionStore.subscribe((state) => {
      if (isHydrating()) {
        prevSessionsRef = state.sessions;
        return;
      }
      diffSessions(state.sessions);
      if (dirtyDates.size) scheduleSync();
    });
    const unsubDeadlines = useDeadlineStore.subscribe((state) => {
      if (isHydrating()) {
        prevDeadlinesRef = state.deadlines;
        return;
      }
      diffDeadlines(state.deadlines);
      if (dirtyDeadlines.size) scheduleSync();
    });

    // pill auto-refresh every 5s for "ago" labels
    const pillTick = setInterval(refreshPill, 5000);

    return () => {
      unsubSessions();
      unsubDeadlines();
      clearInterval(pillTick);
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
  }, [token]);

  return {
    forceSync: () => {
      scheduleSync();
    },
    pullFromCloud,
  };
}
