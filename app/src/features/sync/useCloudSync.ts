// Reactive sync orchestrator. Cloud-first: with a token configured, KV is the
// single source of truth and localStorage is only a cache.
//
// • On mount (token present): the app sits in a `booting` gate until the first
//   pull settles — success means the visible data came from KV (`origin:
//   'cloud'`), failure means it is a stale cache (`origin: 'cache'`). Without
//   a token there is no KV, so local data IS the store of record.
// • Subscribes to both stores to track which items changed locally; the
//   dirty queue is persisted to localStorage so an offline edit survives a
//   reload, and is flushed at +800ms (retry at +4s, +30s on 401/403/429).
// • Before pushing a dirty day it re-reads that day from KV and merges by
//   `updatedAt`, so a stale tab can't clobber newer cloud edits. Local
//   deletions ride along as tombstones, otherwise that merge would resurrect
//   whatever the remote copy still holds.
// • On tab visibilitychange → visible: pushes pending work, then re-pulls.
// • Exposes the current sync state via a small subscription that
//   components like <SyncPill/> can read.

import { useEffect, useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import type { Deadline, DateKey, Session, SessionsByDate, SyncState } from '@/types';
import { addDays, dateKey } from '@/lib/date';
import { pinnedDates } from '@/lib/cachePins';
import { CACHE_WINDOW_DAYS, useSessionStore } from '@/store/useSessionStore';
import { kvClient, HttpError } from './kvClient';

// ─────── pill state (module-level so any component can subscribe) ───────
// where the data currently on screen came from
export type DataOrigin =
  | 'cloud' // a pull succeeded — this is the database
  | 'cache' // token set but the pull failed — stale local copy
  | 'local'; // no token — localStorage is the store of record

type Listener = () => void;
interface PillSnapshot {
  state: SyncState;
  label: string;
  origin: DataOrigin;
  booting: boolean;
  lastCloudAt: number | null;
  lastError: string | null;
  hasCache: boolean;
}
let pillState: SyncState = 'offline';
let pillLabel = 'offline';
let dataOrigin: DataOrigin = 'local';
// stale-while-revalidate: only block the first paint when there is nothing
// cached to show. With a cache on disk it renders immediately and the pull
// reconciles in the background.
let booting = Boolean(useSettingsStore.getState().token) && !localHasData();
let lastSyncAt: number | null = null;
let lastError: string | null = null;
let lastErrorRetryable = true;
// tracked as state rather than derived inside getSnapshot, which has to be
// referentially stable between notifications
let hasCacheFlag = localHasData();
let cachedSnapshot: PillSnapshot = {
  state: pillState,
  label: pillLabel,
  origin: dataOrigin,
  booting,
  lastCloudAt: lastSyncAt,
  lastError,
  hasCache: false,
};
const listeners = new Set<Listener>();

function rebuildSnapshot(): PillSnapshot {
  const s = cachedSnapshot;
  const hasCache = hasCacheFlag;
  if (
    s.state !== pillState ||
    s.label !== pillLabel ||
    s.origin !== dataOrigin ||
    s.booting !== booting ||
    s.lastCloudAt !== lastSyncAt ||
    s.lastError !== lastError ||
    s.hasCache !== hasCache
  ) {
    cachedSnapshot = {
      state: pillState,
      label: pillLabel,
      origin: dataOrigin,
      booting,
      lastCloudAt: lastSyncAt,
      lastError,
      hasCache,
    };
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
function setBooting(value: boolean) {
  booting = value;
  emit();
}
function refreshHasCache() {
  const next = localHasData();
  if (next !== hasCacheFlag) {
    hasCacheFlag = next;
    emit();
  }
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

// A plain "sync error" tells the user nothing. The distinction that matters is
// whether the database rejected them or they never reached it.
function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401) return 'token rejected';
    if (err.status === 403) return 'access denied';
    if (err.status === 429) return 'rate limited by the server';
    return `server returned ${err.status}`;
  }
  // fetch throws a bare TypeError for DNS/TLS/offline/CORS-blocked requests,
  // which is exactly the case where the UI must fall back to the cache
  if (err instanceof TypeError) return 'cloud unreachable';
  return err instanceof Error && err.message ? err.message : 'unknown error';
}

// A rejected token or a disallowed origin will not improve because we asked
// again, so those wait for the user to act rather than looping forever.
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status !== 401 && err.status !== 403 && err.status !== 404;
  }
  return true;
}

// ─────── persistent dirty queue + session tombstones ───────
// Module-level state would be lost on reload, taking any not-yet-flushed
// offline edit with it. Mirror it into localStorage instead.
//
// Tombstones exist because the merge in flushDirty() treats the remote day as
// the base — without a record of what was deleted locally, a deletion would be
// re-added from KV on the next push or pull. A tombstone is only dropped once
// the server is confirmed not to hold that id any more.
const QUEUE_KEY = 'studyplan_dirty_queue';
const META_KEY = 'studyplan_sync_meta';
const TOMBSTONE_TTL = 30 * 86_400_000;

const dirtyDates = new Set<string>();
const dirtyDeadlines = new Map<string, 'put' | 'delete'>();
// date -> (session id -> deletedAt ms)
const tombstones = new Map<string, Map<string, number>>();

function saveQueue() {
  syncPins();
  try {
    if (dirtyDates.size === 0 && dirtyDeadlines.size === 0 && tombstones.size === 0) {
      localStorage.removeItem(QUEUE_KEY);
      return;
    }
    const tomb: [string, string, number][] = [];
    for (const [date, byId] of tombstones) {
      for (const [id, at] of byId) tomb.push([date, id, at]);
    }
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify({
        dates: [...dirtyDates],
        deadlines: [...dirtyDeadlines.entries()],
        tombstones: tomb,
      }),
    );
  } catch {
    // storage unavailable/full — the in-memory queue still works this session
  }
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        dates?: unknown;
        deadlines?: unknown;
        tombstones?: unknown;
      };
      if (Array.isArray(parsed.dates)) {
        for (const d of parsed.dates) if (typeof d === 'string' && d) dirtyDates.add(d);
      }
      if (Array.isArray(parsed.deadlines)) {
        for (const entry of parsed.deadlines) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            (entry[1] === 'put' || entry[1] === 'delete')
          ) {
            dirtyDeadlines.set(entry[0], entry[1]);
          }
        }
      }
      if (Array.isArray(parsed.tombstones)) {
        for (const entry of parsed.tombstones) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            typeof entry[1] === 'string' &&
            Number.isFinite(+entry[2])
          ) {
            addTombstone(entry[0], entry[1], +entry[2]);
          }
        }
      }
    }
  } catch {
    // corrupt queue — ignore and start clean
  }

  try {
    const rawMeta = localStorage.getItem(META_KEY);
    if (rawMeta) {
      const meta = JSON.parse(rawMeta) as { lastCloudAt?: unknown };
      const at = Number(meta.lastCloudAt);
      if (Number.isFinite(at)) lastSyncAt = at;
    }
  } catch {
    // ignore
  }
}

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ lastCloudAt: lastSyncAt }));
  } catch {
    // ignore
  }
}

function addTombstone(date: string, id: string, at = Date.now()) {
  let byId = tombstones.get(date);
  if (!byId) {
    byId = new Map();
    tombstones.set(date, byId);
  }
  byId.set(id, at);
}

function clearTombstone(date: string, id: string) {
  const byId = tombstones.get(date);
  if (!byId) return;
  byId.delete(id);
  if (byId.size === 0) tombstones.delete(date);
}

// tombstones only matter while the server may still hold the row; past the
// TTL (and past the KV day TTL) they're just noise
function pruneTombstones() {
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const [date, byId] of [...tombstones]) {
    for (const [id, at] of [...byId]) if (at < cutoff) byId.delete(id);
    if (byId.size === 0) tombstones.delete(date);
  }
}

// tell the cache window which days it must not evict — see lib/cachePins
function syncPins() {
  pinnedDates.clear();
  for (const date of dirtyDates) pinnedDates.add(date);
  for (const date of tombstones.keys()) pinnedDates.add(date);
}

// ─────── tombstone ⇄ cloud reconciliation ───────
// Filter a pulled day through what this device deleted since, and forget
// tombstones the server has already caught up with. Any day where the filter
// still hides something stays dirty so the delete gets pushed.
function applyTombstones(cloud: SessionsByDate): SessionsByDate {
  if (tombstones.size === 0) return cloud;
  let touched = false;

  for (const date of [...tombstones.keys()]) {
    const remote = cloud[date];
    if (!remote) {
      // the day is gone server-side too — nothing left to delete
      tombstones.delete(date);
      continue;
    }
    for (const [id] of [...tombstones.get(date)!]) {
      if (!remote.some((s) => s.id === id)) clearTombstone(date, id);
    }
    const byId = tombstones.get(date);
    if (!byId) continue;
    for (const s of remote) {
      const at = byId.get(s.id);
      if (at && at > (s.updatedAt ?? 0)) {
        dirtyDates.add(date);
        touched = true;
      }
    }
  }
  if (touched) {
    saveQueue();
    // something this device deleted is still sitting in the database — push it
    // now rather than waiting for the next unrelated edit
    scheduleSync();
  }
  pruneTombstones();

  const out: SessionsByDate = {};
  for (const [date, list] of Object.entries(cloud)) {
    const byId = tombstones.get(date);
    if (!byId) {
      out[date] = list;
      continue;
    }
    const kept = list.filter((s) => {
      const at = byId.get(s.id);
      return !(at && at > (s.updatedAt ?? 0));
    });
    if (kept.length) out[date] = kept;
  }
  return out;
}

loadQueue();
pruneTombstones();
syncPins();

// ─────── boot / focus refresh ───────
let pullPromise: Promise<boolean> | null = null;

function localHasData(): boolean {
  const sessions = useSessionStore.getState().sessions;
  return (
    Object.values(sessions).some((list) => list.length > 0) ||
    useDeadlineStore.getState().deadlines.length > 0
  );
}

// A device that has never synced (no lastCloudAt) but holds data, talking to a
// database that is empty, is the first writer — so push up instead of letting
// an empty cloud wipe it. Once a device has synced before, the database wins
// even when it is empty (someone deleted it).
async function adoptLocalAsCloud(cfg: { token: string; workerUrl: string }): Promise<boolean> {
  const dates = Object.entries(useSessionStore.getState().sessions).filter(([, l]) => l.length > 0);
  const deadlines = useDeadlineStore.getState().deadlines;

  const results = await Promise.allSettled([
    ...dates.map(([date, list]) => kvClient.putSession(cfg, date, list)),
    ...deadlines.map((d) => kvClient.putDeadline(cfg, d)),
  ]);

  if (results.some((r) => r.status === 'rejected')) {
    // hand the unfinished part to the normal queue + retry path
    console.warn('adoption push incomplete, queueing for retry');
    for (const [date] of dates) dirtyDates.add(date);
    for (const d of deadlines) dirtyDeadlines.set(d.id, 'put');
    saveQueue();
    scheduleSync();
    return false;
  }
  console.log(`adopted local data as the initial cloud state: ${dates.length} days, ${deadlines.length} deadlines`);
  return true;
}

async function readCloud(): Promise<boolean> {
  const cfg = {
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  };
  if (!cfg.token) return false;
  try {
    setPill('syncing', 'syncing…');
    const [rawSessions, cloudDeadlines] = await Promise.all([
      kvClient.getAllSessions(cfg),
      kvClient.getDeadlines(cfg),
    ]);

    const cloudEmpty =
      (!rawSessions || Object.keys(rawSessions).length === 0) &&
      (!cloudDeadlines || cloudDeadlines.length === 0);
    if (cloudEmpty && lastSyncAt == null && localHasData()) {
      if (!(await adoptLocalAsCloud(cfg))) {
        dataOrigin = 'cache';
        setPill('error', 'sync error');
        return false;
      }
      lastSyncAt = Date.now();
      lastError = null;
      saveMeta();
      dataOrigin = 'cloud';
      refreshPill();
      return true;
    }

    // Mark stores as hydrating so the dirty tracker ignores this write.
    hydrationDepth++;

    try {
      if (rawSessions) {
        const cloudSessions = applyTombstones(rawSessions);
        useSessionStore.getState().hydrateAll(cloudSessions);
      }
      if (cloudDeadlines) {
        // Auto-purge local entries >3 days past before replacing.
        const { removedIds } = useDeadlineStore.getState().cleanup();
        if (removedIds.length) {
          // best-effort delete on cloud; ignore errors
          await Promise.allSettled(removedIds.map((id) => kvClient.deleteDeadline(cfg, id)));
        }
        // For the replace: take cloud as truth. Any local items missing from
        // cloud are presumed deleted elsewhere.
        useDeadlineStore.getState().replaceAll(cloudDeadlines);
      }
    } finally {
      hydrationDepth--;
    }

    // a successful read is what makes this data the database's, not a cache
    lastSyncAt = Date.now();
    lastError = null;
    lastErrorRetryable = true;
    saveMeta();
    dataOrigin = 'cloud';
    refreshPill();
    return true;
  } catch (err) {
    console.warn('cloud pull failed:', err);
    // whatever is on screen now is only a leftover copy
    lastError = describeError(err);
    lastErrorRetryable = isRetryable(err);
    dataOrigin = 'cache';
    setPill('error', 'sync error');
    return false;
  }
}

// A pull that failed leaves the user looking at a cache of unknown age. Rather
// than waiting for a click or a tab switch, retry on a capped backoff so a
// transient block or rate limit heals on its own.
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let staleDelay = 15_000;

function scheduleStaleRetry() {
  if (staleTimer) return;
  staleTimer = setTimeout(() => {
    staleTimer = null;
    if (useSettingsStore.getState().token && dataOrigin === 'cache') void pullFromCloud();
  }, staleDelay);
  staleDelay = Math.min(staleDelay * 2, 300_000);
}

function clearStaleRetry() {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  staleDelay = 15_000;
}

// The boot gate and a visibility refresh must share one read, not race.
export function pullFromCloud(): Promise<boolean> {
  if (pullPromise) return pullPromise;
  if (!useSettingsStore.getState().token) return Promise.resolve(false);
  pullPromise = readCloud()
    .then((ok) => {
      if (ok) clearStaleRetry();
      else if (lastErrorRetryable) scheduleStaleRetry();
      else clearStaleRetry();
      return ok;
    })
    .finally(() => {
      pullPromise = null;
    });
  return pullPromise;
}

// Push whatever is pending, then pull. Order matters: pulling first would
// replace local state and silently drop edits that were never sent.
export async function refreshFromCloud(): Promise<void> {
  if (dirtyDates.size || dirtyDeadlines.size) await flushDirty();
  await pullFromCloud();
}

// Boot path. Stale-while-revalidate: a device that already has a cached copy
// paints it immediately and reconciles against the database behind it, because
// blocking a working screen on a network round-trip trades a background
// degradation for a dead-looking app. Only a device with nothing to show waits.
export async function bootFromCloud(): Promise<void> {
  setBooting(!localHasData());
  try {
    await refreshFromCloud();
  } finally {
    setBooting(false);
  }
}

// ─────── days outside the cache window ───────
// The cache only holds CACHE_WINDOW_DAYS of history, so older days the user
// navigates back to have to come from the database. One request per date per
// session; a failed one is retried the next time that date is opened.
const fetchedDates = new Set<DateKey>();

export async function ensureDateLoaded(date: DateKey): Promise<void> {
  const cfg = {
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  };
  // no cloud to read from, or the boot pull already covered this day
  if (!cfg.token) return;
  if (date >= dateKey(addDays(new Date(), -CACHE_WINDOW_DAYS))) return;
  if (useSessionStore.getState().sessions[date]) return;
  if (fetchedDates.has(date)) return;
  fetchedDates.add(date);

  try {
    const remote = await kvClient.getSession(cfg, date);
    if (!remote || remote.length === 0) return;
    // a deletion this device has not pushed yet stays deleted, even while
    // looking at the older server copy
    const kept = applyTombstones({ [date]: remote })[date];
    if (!kept || kept.length === 0) return;
    hydrationDepth++;
    try {
      useSessionStore.getState().replaceForDate(date, kept);
    } finally {
      hydrationDepth--;
    }
  } catch (err) {
    fetchedDates.delete(date);
    console.warn('could not load ' + date + ':', err);
  }
}

// ─────── dirty tracking + debounced flush ───────
let hydrationDepth = 0;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;

function isHydrating() {
  return hydrationDepth > 0;
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void flushDirty();
  }, 800);
}

// Longer backoff for failures that retrying quickly won't fix.
function retryDelayFor(err: unknown): number {
  if (err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 429)) {
    return 30_000;
  }
  return 4_000;
}

// Pull-before-push merge. The remote list is the base so deletions made on
// another device aren't resurrected, but any local edit that is strictly newer
// wins. Locally-created items survive only when our day isn't older than the
// cloud's — otherwise they were most likely deleted elsewhere. Anything this
// device deleted after the remote copy was written stays deleted.
function mergeSessions(
  remote: Session[],
  local: Session[],
  deleted?: Map<string, number>,
): Session[] {
  const localById = new Map(local.map((s) => [s.id, s]));
  const remoteIds = new Set(remote.map((s) => s.id));
  const newest = (list: Session[]) => list.reduce((m, s) => Math.max(m, s.updatedAt ?? 0), 0);
  const remoteNewest = newest(remote);
  const localNewest = newest(local);

  const out = new Map<string, Session>();
  for (const r of remote) {
    const at = deleted?.get(r.id);
    if (at && at > (r.updatedAt ?? 0)) continue;
    const l = localById.get(r.id);
    out.set(r.id, l && (l.updatedAt ?? 0) > (r.updatedAt ?? 0) ? l : r);
  }
  for (const l of local) {
    if (remoteIds.has(l.id)) continue;
    if (deleted?.has(l.id)) continue;
    if (localNewest >= remoteNewest) out.set(l.id, l);
  }
  return [...out.values()];
}

function flushDirty(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  const token = useSettingsStore.getState().token;
  if (!token) return Promise.resolve();
  if (dirtyDates.size === 0 && dirtyDeadlines.size === 0) return Promise.resolve();

  flushPromise = (async () => {
    setPill('syncing', 'syncing…');

    const cfg = {
      token: useSettingsStore.getState().token,
      workerUrl: useSettingsStore.getState().workerUrl,
    };
    const dates = [...dirtyDates];
    const dls = [...dirtyDeadlines.entries()];
    let failed = false;
    let authBlocked = false;
    let retryIn = 4_000;

    for (const date of dates) {
      try {
        const local: Session[] = useSessionStore.getState().sessions[date] ?? [];
        const deleted = tombstones.get(date);
        if (local.length === 0) {
          await kvClient.deleteSessionDate(cfg, date);
          // the whole day is gone server-side, so its tombstones are done
          tombstones.delete(date);
        } else {
          // re-read the day so a stale client can't clobber newer cloud edits
          const remote = await kvClient.getSession(cfg, date);
          const list = remote && remote.length ? mergeSessions(remote, local, deleted) : local;
          await kvClient.putSession(cfg, date, list);
          if (remote && remote.length) {
            // adopt anything the merge pulled in, without re-marking it dirty
            hydrationDepth++;
            try {
              useSessionStore.getState().replaceForDate(date, list);
            } finally {
              hydrationDepth--;
            }
          }
        }
        // only drop the queued work once the write actually succeeded
        dirtyDates.delete(date);
        saveQueue();
      } catch (err) {
        console.warn('PUT session ' + date + ' failed:', err);
        if (!lastError) lastError = describeError(err);
        if (!isRetryable(err)) authBlocked = true;
        retryIn = Math.max(retryIn, retryDelayFor(err));
        failed = true;
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
          if (d) {
            const res = await kvClient.putDeadline(cfg, d);
            // the worker keeps the newer copy and reports it as stale; the
            // next pull reconciles the local view
            if (res?.stale) console.info('deadline ' + id + ': server copy is newer, kept it');
          }
        }
        dirtyDeadlines.delete(id);
        saveQueue();
      } catch (err) {
        console.warn(op + ' deadline ' + id + ' failed:', err);
        if (!lastError) lastError = describeError(err);
        if (!isRetryable(err)) authBlocked = true;
        retryIn = Math.max(retryIn, retryDelayFor(err));
        failed = true;
      }
    }

    if (failed) {
      // an auth or permission failure needs the user, not another attempt; the
      // queue stays on disk until they fix it or reload
      if (!authBlocked) {
        retryTimer = setTimeout(() => {
          void flushDirty();
        }, retryIn);
      }
      setPill('error', 'sync error');
    } else {
      lastSyncAt = Date.now();
      refreshPill();
      // items that were marked dirty while this flush was in flight
      if (dirtyDates.size || dirtyDeadlines.size) scheduleSync();
    }
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

// ─────── store subscriptions ───────
let prevSessionsRef: Record<string, Session[]> = {};
let prevDeadlinesRef: Deadline[] = [];

function diffSessions(curr: Record<string, Session[]>) {
  const prev = prevSessionsRef;
  const keys = new Set([...Object.keys(curr), ...Object.keys(prev)]);
  let changed = false;
  for (const k of keys) {
    if (curr[k] === prev[k]) continue;
    dirtyDates.add(k);
    changed = true;

    // remember what this device deleted so the merge can subtract it, and
    // forget tombstones for anything that came back (undo, re-add, edit)
    const currIds = new Set((curr[k] ?? []).map((s) => s.id));
    const prevIds = new Set((prev[k] ?? []).map((s) => s.id));
    for (const id of prevIds) if (!currIds.has(id)) addTombstone(k, id);
    for (const id of currIds) if (!prevIds.has(id)) clearTombstone(k, id);
  }
  prevSessionsRef = curr;
  if (changed) saveQueue();
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
  saveQueue();
}

// ─────── main hook ───────
export function useCloudSync() {
  const token = useSettingsStore((s) => s.token);

  // boot + subscriptions + focus refresh. Re-runs when token flips.
  useEffect(() => {
    if (!token) {
      // no KV to defer to — local data is the store of record
      dataOrigin = 'local';
      clearStaleRetry();
      setBooting(false);
      setPill('offline', 'offline');
      return;
    }

    // seed refs with current state so first change correctly diffs
    prevSessionsRef = useSessionStore.getState().sessions;
    prevDeadlinesRef = useDeadlineStore.getState().deadlines;

    // boot: flush anything pending from a previous session, then make the
    // database authoritative for what the user sees
    void bootFromCloud();

    // subscribe
    const unsubSessions = useSessionStore.subscribe((state) => {
      refreshHasCache();
      if (isHydrating()) {
        prevSessionsRef = state.sessions;
        return;
      }
      diffSessions(state.sessions);
      if (dirtyDates.size) scheduleSync();
    });
    const unsubDeadlines = useDeadlineStore.subscribe((state) => {
      refreshHasCache();
      if (isHydrating()) {
        prevDeadlinesRef = state.deadlines;
        return;
      }
      diffDeadlines(state.deadlines);
      if (dirtyDeadlines.size) scheduleSync();
    });

    // coming back to the tab: push pending edits, then re-pull so data
    // created elsewhere (another device, or the ingest API) shows up.
    // No loading gate here — the screen already has data on it.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshFromCloud();
    };
    document.addEventListener('visibilitychange', onVisible);

    // pill auto-refresh every 5s for "ago" labels
    const pillTick = setInterval(refreshPill, 5000);

    return () => {
      unsubSessions();
      unsubDeadlines();
      document.removeEventListener('visibilitychange', onVisible);
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
