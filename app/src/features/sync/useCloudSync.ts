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
// • The day's 1–10 rating lives inside the session day key, so rating edits
//   mark the same dirtyDates queue and merge with the same pull-before-push
//   step (newer ratingUpdatedAt wins) — no separate collection, no extra reads.
// • On tab visibilitychange → visible: pushes pending work, then re-pulls.
// • Exposes the current sync state via a small subscription that
//   components like <SyncPill/> can read.

import { useEffect, useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import { useSubjectStore, seedSubjectsFromSessions } from '@/store/useSubjectStore';
import { useNoteStore } from '@/store/useNoteStore';
import type { Deadline, DateKey, Note, RatingEntry, RatingsByDate, Session, SessionsByDate, Subject, SyncState } from '@/types';
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
// incremental-pull watermark, always on the SERVER's clock (same clock as the
// key metadata). Kept separate from lastSyncAt (client clock, pill display):
// mixing clocks could permanently skip a write that lands inside the skew.
let serverWatermark: number | null = null;
let lastError: string | null = null;
// Focus and tab-switch pulls are debounced: rapid clicking between two
// side-by-side windows would otherwise fire a full pull per click, and the
// 1,000/day list quota is the tightest one. Boot and explicit refreshes
// bypass the debounce — see debouncedSync in the hook.
let lastPullAt = 0;
const PULL_DEBOUNCE_MS = 10_000;
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
const dirtySubjects = new Map<string, 'put' | 'delete'>();
const dirtyNotes = new Map<string, 'put' | 'delete'>();
// KV throttles same-key writes to 1/sec: note id -> last attempt timestamp, so
// a flush landing <1s after the previous write defers instead of failing loudly
const NOTE_WRITE_MIN_GAP_MS = 1_000;
const lastNoteWriteAt = new Map<string, number>();
// date -> (session id -> deletedAt ms)
const tombstones = new Map<string, Map<string, number>>();

function saveQueue() {
  syncPins();
  try {
    if (
      dirtyDates.size === 0 &&
      dirtyDeadlines.size === 0 &&
      dirtySubjects.size === 0 &&
      dirtyNotes.size === 0 &&
      tombstones.size === 0
    ) {
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
        subjects: [...dirtySubjects.entries()],
        notes: [...dirtyNotes.entries()],
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
        subjects?: unknown;
        notes?: unknown;
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
      if (Array.isArray(parsed.subjects)) {
        for (const entry of parsed.subjects) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            (entry[1] === 'put' || entry[1] === 'delete')
          ) {
            dirtySubjects.set(entry[0], entry[1]);
          }
        }
      }
      if (Array.isArray(parsed.notes)) {
        for (const entry of parsed.notes) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            (entry[1] === 'put' || entry[1] === 'delete')
          ) {
            dirtyNotes.set(entry[0], entry[1]);
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
      const meta = JSON.parse(rawMeta) as { lastCloudAt?: unknown; watermark?: unknown };
      const at = Number(meta.lastCloudAt);
      if (Number.isFinite(at)) lastSyncAt = at;
      const wm = Number(meta.watermark);
      if (Number.isFinite(wm)) serverWatermark = wm;
    }
  } catch {
    // ignore
  }
}

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ lastCloudAt: lastSyncAt, watermark: serverWatermark }));
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
// One-time bootstrap of the subject catalog from whatever's already in the
// sessions cache, so the Settings tab isn't empty for a returning user. The
// flag inside the seed function prevents re-seeding an emptied catalog.
// Fire-and-forget; the diff subscription picks up the seeded entries and
// the normal flush uploads them.
void seedSubjectsFromSessions();

// Reconcile a pulled list (subjects/notes) with the local copy.
//
// Cloud wins for ids it holds — but a local edit we still owe the cloud
// (pending 'put') may be newer, so the newer of the two is kept. A local item
// the cloud does NOT have is kept only while we still owe an upload for it;
// otherwise it was deleted on another device and dropping it is correct.
//
// What this replaces: treating "missing from cloud" as "deleted here" and
// queueing a DELETE. A just-typed note is still queued as a 'put', so any pull
// landing first (a failed/retried push, or a refresh inside the debounce) would
// flip it to 'delete', drop it locally, and erase it from KV. Explicit deletes
// are already queued by diffNotes/diffSubjects, so inferring them here was both
// redundant and destructive.
function mergePulled<T extends { id: string; updatedAt: number }>(
  cloud: T[],
  local: T[],
  pending: Map<string, 'put' | 'delete'>,
): T[] {
  const pendingPuts = new Set(
    [...pending.entries()].filter(([, op]) => op === 'put').map(([id]) => id),
  );
  const localById = new Map(local.map((x) => [x.id, x] as const));
  const cloudIds = new Set(cloud.map((x) => x.id));

  const merged: T[] = cloud.map((c) => {
    const l = localById.get(c.id);
    return l && pendingPuts.has(c.id) && l.updatedAt > c.updatedAt ? l : c;
  });
  for (const l of local) {
    if (!cloudIds.has(l.id) && pendingPuts.has(l.id)) merged.push(l);
  }
  return merged;
}

// ─────── boot / focus refresh ───────
let pullPromise: Promise<boolean> | null = null;

function localHasData(): boolean {
  const sessions = useSessionStore.getState().sessions;
  const ratings = useSessionStore.getState().ratings;
  return (
    Object.values(sessions).some((list) => list.length > 0) ||
    Object.values(ratings).some((r) => r.value != null) ||
    useDeadlineStore.getState().deadlines.length > 0 ||
    useSubjectStore.getState().subjects.length > 0 ||
    useNoteStore.getState().notes.length > 0
  );
}

// A device that has never synced (no lastCloudAt) but holds data, talking to a
// database that is empty, is the first writer — so push up instead of letting
// an empty cloud wipe it. Once a device has synced before, the database wins
// even when it is empty (someone deleted it).
async function adoptLocalAsCloud(cfg: { token: string; workerUrl: string }): Promise<boolean> {
  const st = useSessionStore.getState();
  const ratingOf = (date: DateKey): RatingEntry | undefined => {
    const r = st.ratings[date];
    return r && r.value != null ? r : undefined;
  };
  // rating-only days (empty sessions but a local rating) must be pushed too,
  // or the adoption would orphan them
  const dates = [
    ...new Set([
      ...Object.entries(st.sessions)
        .filter(([, l]) => l.length > 0)
        .map(([d]) => d),
      ...Object.keys(st.ratings).filter((d) => ratingOf(d) !== undefined),
    ]),
  ];
  const deadlines = useDeadlineStore.getState().deadlines;
  const subjects = useSubjectStore.getState().subjects;
  const notes = useNoteStore.getState().notes;

  const results = await Promise.allSettled([
    ...dates.map((date) => kvClient.putSession(cfg, date, st.sessions[date] ?? [], ratingOf(date))),
    ...deadlines.map((d) => kvClient.putDeadline(cfg, d)),
    ...subjects.map((s) => kvClient.putSubject(cfg, s)),
    ...notes.map((n) => kvClient.putNote(cfg, n)),
  ]);

  if (results.some((r) => r.status === 'rejected')) {
    // hand the unfinished part to the normal queue + retry path
    console.warn('adoption push incomplete, queueing for retry');
    for (const date of dates) dirtyDates.add(date);
    for (const d of deadlines) dirtyDeadlines.set(d.id, 'put');
    for (const s of subjects) dirtySubjects.set(s.id, 'put');
    for (const n of notes) dirtyNotes.set(n.id, 'put');
    saveQueue();
    scheduleSync();
    return false;
  }
  const rated = dates.filter((d) => ratingOf(d) !== undefined).length;
  console.log(
    `adopted local data as the initial cloud state: ${dates.length} days (${rated} rated), ${deadlines.length} deadlines, ${subjects.length} subjects, ${notes.length} notes`,
  );
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

    // One request for the whole plan (a single namespace-wide list server-side).
    // Falls back to the four per-collection requests when the worker predates
    // /api/all, so the frontend and worker can deploy in any order.
    // With a watermark the server value-reads only days changed after it and
    // reports deleted days — steady-state pulls cost ~0 value reads.
    // serverWatermark is null until the first successful pull → full pull.
    const since = serverWatermark;
    let rawSessions: SessionsByDate | null;
    let cloudRatings: RatingsByDate | undefined;
    let cloudDeadlines: Deadline[] | null;
    let cloudSubjects: Subject[] | null;
    let cloudNotes: Note[] | null;
    let removedDates: string[] | null = null;
    const all = await kvClient.getAll(cfg, since);
    // a legacy worker returns no `removedDates` — treat its snapshot as full
    const incremental = all != null && Array.isArray(all.removedDates);
    if (all) {
      rawSessions = all.sessions;
      // a worker predating ratings omits the field entirely — local ratings
      // (dirty or not) must be left alone until a worker that knows them
      if (all.ratings !== undefined) cloudRatings = all.ratings;
      cloudDeadlines = all.deadlines;
      cloudSubjects = all.subjects;
      cloudNotes = all.notes;
      if (incremental) removedDates = all.removedDates ?? null;
    } else {
      [rawSessions, cloudDeadlines, cloudSubjects, cloudNotes] = await Promise.all([
        kvClient.getAllSessions(cfg),
        kvClient.getDeadlines(cfg),
        kvClient.getSubjects(cfg),
        kvClient.getNotes(cfg),
      ]);
    }

    lastPullAt = Date.now();

    const cloudEmpty =
      (!rawSessions || Object.keys(rawSessions).length === 0) &&
      (!cloudDeadlines || cloudDeadlines.length === 0) &&
      (!cloudSubjects || cloudSubjects.length === 0) &&
      (!cloudNotes || cloudNotes.length === 0);
    // an incremental pull legitimately returns empty sessions when nothing
    // changed — that must never trigger adoption, which would re-push the
    // whole local store as "initial cloud state". Adoption is a full-pull-only
    // path (it also requires lastSyncAt == null, i.e. no watermark yet).
    if (!incremental && cloudEmpty && lastSyncAt == null && localHasData()) {
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
        if (incremental) {
          // never clobber a day this device still owes a push for: those edits
          // merge at flush time (mergeSessions), and the retry flush reads the
          // store — replacing them with the older cloud copy would lose them.
          // The same guard covers ratings: a dirty day's rating merges at
          // flush time (newer ratingUpdatedAt wins).
          const changed = Object.fromEntries(
            Object.entries(rawSessions).filter(([date]) => !dirtyDates.has(date)),
          );
          const removed = (removedDates ?? []).filter((d) => !dirtyDates.has(d));
          const ratingsChanged = cloudRatings
            ? Object.fromEntries(
                Object.entries(cloudRatings).filter(([date]) => !dirtyDates.has(date)),
              )
            : undefined;
          useSessionStore.getState().hydrateChanged(applyTombstones(changed), removed, ratingsChanged);
        } else {
          const cloudSessions = applyTombstones(rawSessions);
          useSessionStore.getState().hydrateAll(cloudSessions, cloudRatings);
        }
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
      if (cloudSubjects) {
        useSubjectStore.getState().replaceAll(mergePulled(
          cloudSubjects,
          useSubjectStore.getState().subjects,
          dirtySubjects,
        ));
      }
      if (cloudNotes) {
        useNoteStore.getState().replaceAll(mergePulled(
          cloudNotes,
          useNoteStore.getState().notes,
          dirtyNotes,
        ));
      }
    } finally {
      hydrationDepth--;
    }

    // a successful read is what makes this data the database's, not a cache.
    // the watermark is the SERVER's pre-list timestamp: same clock as the key
    // metadata, so a write landing mid-pull is caught by the next pull (no gap)
    lastSyncAt = Date.now();
    if (all?.updatedAt != null && Number.isFinite(all.updatedAt)) {
      serverWatermark = all.updatedAt;
    }
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
// automatic retries give up after this many consecutive failures — a revoked
// token or dead worker would otherwise pull once a minute per open tab,
// forever. The pill keeps showing the error; the next explicit user action
// (pill click, refresh button, focus pull) starts a fresh attempt budget.
const MAX_STALE_ATTEMPTS = 10;
let staleAttempts = 0;

function scheduleStaleRetry() {
  if (staleTimer) return;
  if (staleAttempts >= MAX_STALE_ATTEMPTS) return;
  staleAttempts++;
  staleTimer = setTimeout(() => {
    staleTimer = null;
    // re-sync (push first) rather than a bare pull — a pull hydrates the whole
    // session map and would drop edits that haven't been pushed yet
    if (useSettingsStore.getState().token && dataOrigin === 'cache') void refreshFromCloud();
  }, staleDelay);
  // cap at a minute: retries 15s → 30s → 60s, so a stale cache can't sit for
  // five minutes after a transient failure
  staleDelay = Math.min(staleDelay * 2, 60_000);
}

function clearStaleRetry() {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  staleDelay = 15_000;
  staleAttempts = 0;
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
// `manual` marks an explicit user action (pill click, refresh button): it
// clears any pending automatic retry and restarts the attempt budget.
export async function refreshFromCloud(opts?: { manual?: boolean }): Promise<void> {
  if (opts?.manual) {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
    staleAttempts = 0;
  }
  if (
    dirtyDates.size ||
    dirtyDeadlines.size ||
    dirtySubjects.size ||
    dirtyNotes.size
  ) {
    await flushDirty();
  }
  await pullFromCloud();
}

// ─────── notes-page actions ───────

// Opening one note: fetch just that note's body (a single read). Falls back to
// the cached copy when offline or the note was never synced. When this device
// still owes a save for the note, the local copy IS the newest — the flush's
// LWW will resolve against the server — so it's returned untouched.
// In-flight requests are shared per id (StrictMode double-mount = one fetch),
// but a call whose stored signal was aborted never reuses that promise — the
// remount after cleanup always starts a fresh fetch.
const inflightNoteBodies = new Map<string, { promise: Promise<Note | null>; signal?: AbortSignal }>();

export async function fetchNoteBody(id: string, signal?: AbortSignal): Promise<Note | null> {
  const cached = useNoteStore.getState().notes.find((n) => n.id === id) ?? null;
  const cfg = {
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  };
  if (!cfg.token) return cached;
  if (dirtyNotes.get(id) === 'put') return cached;
  const running = inflightNoteBodies.get(id);
  if (running && !running.signal?.aborted) return running.promise;
  let p!: Promise<Note | null>;
  p = (async () => {
    try {
      const note = await kvClient.getNote(cfg, id, signal ? { signal } : undefined);
      if (note) {
        hydrationDepth++;
        try {
          useNoteStore.getState().applyFetched(note);
        } finally {
          hydrationDepth--;
        }
      }
      return note ?? cached;
    } catch {
      return cached;
    } finally {
      const cur = inflightNoteBodies.get(id);
      if (cur?.promise === p) inflightNoteBodies.delete(id);
    }
  })();
  inflightNoteBodies.set(id, { promise: p, signal });
  return p;
}

// The notes-page refresh button: push any pending note writes, then re-fetch
// the metadata list — one list operation — and merge it into the store.
// Metadata wins per row (mergePulled keeps pending puts), and cached bodies
// are preserved by replaceAll.
export async function refreshNotesList(): Promise<void> {
  const cfg = {
    token: useSettingsStore.getState().token,
    workerUrl: useSettingsStore.getState().workerUrl,
  };
  if (!cfg.token) return;
  if (dirtyNotes.size) await flushDirty();
  try {
    const items = await kvClient.getNotes(cfg);
    if (items) {
      hydrationDepth++;
      try {
        useNoteStore
          .getState()
          .replaceAll(mergePulled(items, useNoteStore.getState().notes, dirtyNotes));
      } finally {
        hydrationDepth--;
      }
    }
  } catch (err) {
    // a failed refresh means the list on screen is only a cache — say so on
    // the pill/banner instead of failing silently
    console.warn('notes refresh failed:', err);
    lastError = describeError(err);
    dataOrigin = 'cache';
    setPill('error', 'sync error');
  }
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
    if (!remote) return;
    // a deletion this device has not pushed yet stays deleted, even while
    // looking at the older server copy
    const list = remote.sessions ?? [];
    const kept = applyTombstones({ [date]: list })[date] ?? [];
    hydrationDepth++;
    try {
      if (kept.length > 0) {
        useSessionStore.getState().replaceForDate(date, kept);
      }
      // a rating this device still owes a push for wins at flush time — don't
      // let the older server copy overwrite it here
      if (!dirtyDates.has(date)) {
        useSessionStore.getState().adoptRating(
          date,
          remote.rating != null
            ? { value: remote.rating, updatedAt: remote.ratingUpdatedAt ?? 0 }
            : undefined,
        );
      }
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

// Day-rating merge for the pull-before-push flush: newer updatedAt wins
// (null = cleared, and a clear is a real value with a stamp). Local wins
// ties so a just-made edit isn't undone by a same-millisecond remote write.
function mergeRating(
  local: RatingEntry | undefined,
  remote: RatingEntry | undefined,
): RatingEntry | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0) ? local : remote;
}

function flushDirty(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  const token = useSettingsStore.getState().token;
  if (!token) return Promise.resolve();
  if (
    dirtyDates.size === 0 &&
    dirtyDeadlines.size === 0 &&
    dirtySubjects.size === 0 &&
    dirtyNotes.size === 0
  ) {
    return Promise.resolve();
  }

  flushPromise = (async () => {
    setPill('syncing', 'syncing…');

    const cfg = {
      token: useSettingsStore.getState().token,
      workerUrl: useSettingsStore.getState().workerUrl,
    };
    const dates = [...dirtyDates];
    const dls = [...dirtyDeadlines.entries()];
    const subs = [...dirtySubjects.entries()];
    const nts = [...dirtyNotes.entries()];
    let failed = false;
    let authBlocked = false;
    let retryIn = 4_000;

    for (const date of dates) {
      try {
        const st = useSessionStore.getState();
        const local: Session[] = st.sessions[date] ?? [];
        const localRating: RatingEntry | undefined = st.ratings[date];
        const deleted = tombstones.get(date);
        // re-read the day so a stale client can't clobber newer cloud edits
        const remote = await kvClient.getSession(cfg, date);
        const remoteList = remote?.sessions ?? null;
        const list = remoteList && remoteList.length ? mergeSessions(remoteList, local, deleted) : local;
        // rating: newer updatedAt wins; the winner is written back below so
        // both devices converge. Absent on both sides → nothing is sent and
        // the server keeps whatever it has (its preserve rule).
        const remoteRating: RatingEntry | undefined =
          remote?.rating != null
            ? { value: remote.rating, updatedAt: remote.ratingUpdatedAt ?? 0 }
            : undefined;
        const finalRating = mergeRating(localRating, remoteRating);
        // a rating-only day (no sessions left) is a real day — only delete
        // when there is neither a session nor a surviving rating to keep. A
        // winning clear (value null) with no sessions also deletes the day.
        if (list.length === 0 && (finalRating == null || finalRating.value == null)) {
          await kvClient.deleteSessionDate(cfg, date);
          // the whole day is gone server-side, so its tombstones are done
          tombstones.delete(date);
        } else {
          await kvClient.putSession(cfg, date, list, finalRating);
          // adopt anything the merge pulled in, without re-marking it dirty.
          // A winning clear removes the entry so the store agrees with the
          // server (which stores no rating at all after a clear).
          hydrationDepth++;
          try {
            useSessionStore.getState().replaceForDate(date, list);
            useSessionStore.getState().adoptRating(
              date,
              finalRating?.value != null ? finalRating : undefined,
            );
          } finally {
            hydrationDepth--;
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

    for (const [id, op] of subs) {
      try {
        if (op === 'delete') {
          await kvClient.deleteSubject(cfg, id);
        } else {
          const s: Subject | undefined = useSubjectStore
            .getState()
            .subjects.find((x) => x.id === id);
          if (s) {
            const res = await kvClient.putSubject(cfg, s);
            if (res?.stale) console.info('subject ' + id + ': server copy is newer, kept it');
          }
        }
        dirtySubjects.delete(id);
        saveQueue();
      } catch (err) {
        console.warn(op + ' subject ' + id + ' failed:', err);
        if (!lastError) lastError = describeError(err);
        if (!isRetryable(err)) authBlocked = true;
        retryIn = Math.max(retryIn, retryDelayFor(err));
        failed = true;
      }
    }

    for (const [id, op] of nts) {
      try {
        // same-key 1/sec throttle: a flush landing <1s after the previous
        // write to this note would be rejected with a phantom "sync error".
        // Defer it to the normal debounced path instead — no failure recorded.
        if (Date.now() - (lastNoteWriteAt.get(id) ?? 0) < NOTE_WRITE_MIN_GAP_MS) {
          scheduleSync();
          continue;
        }
        if (op === 'delete') {
          await kvClient.deleteNote(cfg, id);
        } else {
          const n: Note | undefined = useNoteStore.getState().notes.find((x) => x.id === id);
          if (n && n.text !== undefined) {
            const res = await kvClient.putNote(cfg, n);
            // server has newer text — adopt it so the open note shows the winner
            if (res?.stale && res.item) {
              console.info('note ' + id + ': server copy is newer, adopted it');
              hydrationDepth++;
              try {
                useNoteStore.getState().applyFetched(res.item);
              } finally {
                hydrationDepth--;
              }
            }
          } else {
            // no body to push (metadata-only row) — drop the stale queue entry
            console.warn('note ' + id + ': queued put has no body, dropping');
          }
        }
        dirtyNotes.delete(id);
        lastNoteWriteAt.set(id, Date.now());
        saveQueue();
      } catch (err) {
        console.warn(op + ' note ' + id + ' failed:', err);
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
      if (dirtyDates.size || dirtyDeadlines.size || dirtySubjects.size || dirtyNotes.size) {
        scheduleSync();
      }
    }
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

// Resolves when the push of whatever the caller just queued settles:
// 'saved' once the queue is fully flushed, 'error' when the flush was
// blocked (rejected token, offline retry loop). The local copy is saved
// either way; a retry stays scheduled and the pill keeps reporting it.
export function waitForSaved(): Promise<'saved' | 'error'> {
  return new Promise((resolve) => {
    // a save right after a previous 'error' would settle instantly on that
    // stale state, so success requires catching the flush actually run
    let sawSyncing = pillState === 'syncing';
    const settle = (result: 'saved' | 'error') => {
      unsub();
      clearTimeout(guard);
      resolve(result);
    };
    const check = () => {
      if (pillState === 'syncing') {
        sawSyncing = true;
      } else if (pillState === 'error') {
        settle('error');
      } else if (
        sawSyncing &&
        flushPromise === null &&
        dirtyDates.size === 0 &&
        dirtyDeadlines.size === 0 &&
        dirtySubjects.size === 0 &&
        dirtyNotes.size === 0
      ) {
        settle('saved');
      }
    };
    const unsub = subscribe(check);
    const guard = setTimeout(() => settle(pillState === 'error' ? 'error' : 'saved'), 60_000);
  });
}

// ─────── store subscriptions ───────
let prevSessionsRef: Record<string, Session[]> = {};
let prevRatingsRef: RatingsByDate = {};
let prevDeadlinesRef: Deadline[] = [];
let prevSubjectsRef: Subject[] = [];
let prevNotesRef: Note[] = [];

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

// Ratings live in the session store but mark the same dirtyDates queue — the
// flush pushes the whole day (sessions + rating) in one PUT, keyed by date.
function diffRatings(curr: RatingsByDate) {
  const prev = prevRatingsRef;
  const keys = new Set([...Object.keys(curr), ...Object.keys(prev)]);
  let changed = false;
  for (const k of keys) {
    if (curr[k] === prev[k]) continue;
    dirtyDates.add(k);
    changed = true;
  }
  prevRatingsRef = curr;
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

function diffSubjects(curr: Subject[]) {
  const prev = prevSubjectsRef;
  if (curr === prev) return;
  const prevById = new Map(prev.map((s) => [s.id, s] as const));
  for (const s of curr) {
    const before = prevById.get(s.id);
    if (!before || before !== s) dirtySubjects.set(s.id, 'put');
  }
  const currIds = new Set(curr.map((s) => s.id));
  for (const s of prev) {
    if (!currIds.has(s.id)) dirtySubjects.set(s.id, 'delete');
  }
  prevSubjectsRef = curr;
  saveQueue();
}

function diffNotes(curr: Note[]) {
  const prev = prevNotesRef;
  if (curr === prev) return;
  const prevById = new Map(prev.map((n) => [n.id, n] as const));
  for (const n of curr) {
    const before = prevById.get(n.id);
    // A metadata-only row (list refresh) must never queue a push — there is no
    // body to save, and the worker would 400 a text-less PUT.
    if (!before || before !== n) {
      if (n.text !== undefined) dirtyNotes.set(n.id, 'put');
    }
  }
  const currIds = new Set(curr.map((n) => n.id));
  for (const n of prev) {
    if (!currIds.has(n.id)) dirtyNotes.set(n.id, 'delete');
  }
  prevNotesRef = curr;
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
    prevRatingsRef = useSessionStore.getState().ratings;
    prevDeadlinesRef = useDeadlineStore.getState().deadlines;
    prevSubjectsRef = useSubjectStore.getState().subjects;
    prevNotesRef = useNoteStore.getState().notes;

    // boot: flush anything pending from a previous session, then make the
    // database authoritative for what the user sees
    void bootFromCloud();

    // subscribe
    const unsubSessions = useSessionStore.subscribe((state) => {
      refreshHasCache();
      if (isHydrating()) {
        prevSessionsRef = state.sessions;
        prevRatingsRef = state.ratings;
        return;
      }
      diffSessions(state.sessions);
      diffRatings(state.ratings);
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
    const unsubSubjects = useSubjectStore.subscribe((state) => {
      refreshHasCache();
      if (isHydrating()) {
        prevSubjectsRef = state.subjects;
        return;
      }
      diffSubjects(state.subjects);
      if (dirtySubjects.size) scheduleSync();
    });
    const unsubNotes = useNoteStore.subscribe((state) => {
      refreshHasCache();
      if (isHydrating()) {
        prevNotesRef = state.notes;
        return;
      }
      diffNotes(state.notes);
      if (dirtyNotes.size) scheduleSync();
    });

    // Coming back to the tab: push pending edits, then re-pull so data created
    // elsewhere (another device, or the ingest API) shows up. No loading gate
    // here — the screen already has data on it.
    //
    // Leaving the tab: push NOW. Chrome throttles timers in hidden tabs to about
    // once a minute, so the pending 800ms flush would otherwise sit un-sent
    // while the user is looking at the other browser. `visibilitychange` fires
    // immediately even though timers don't, so the edit goes out as the tab
    // goes away.
    const flushIfPending = () => {
      if (
        dirtyDates.size ||
        dirtyDeadlines.size ||
        dirtySubjects.size ||
        dirtyNotes.size
      ) {
        void flushDirty();
      }
    };

    // Focus/tab-switch pulls are debounced: two windows side by side fire focus
    // on every click, and a full pull per click would chew the 1,000/day list
    // quota. Pending edits are NEVER debounced — only the pull is. Boot and the
    // explicit refresh button call refreshFromCloud directly and bypass this.
    const debouncedSync = () => {
      flushIfPending();
      if (Date.now() - lastPullAt < PULL_DEBOUNCE_MS) return;
      void refreshFromCloud();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') debouncedSync();
      else flushIfPending();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Two windows side by side never change tab visibility, so a window focus
    // is the only cue that the user might be looking at this copy.
    window.addEventListener('focus', debouncedSync);

    // pill auto-refresh every 5s for "ago" labels
    const pillTick = setInterval(refreshPill, 5000);

    return () => {
      unsubSessions();
      unsubDeadlines();
      unsubSubjects();
      unsubNotes();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', debouncedSync);
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
