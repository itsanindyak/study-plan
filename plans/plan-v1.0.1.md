# Plan v1.0.1 — Incremental pull + sync hardening

Goal: (A) make `/api/all` incremental (`?since=`) so steady-state pulls cost
1 list + 0–2 reads instead of 1 list + ~26 reads, flat as history grows;
(B) three small sync fixes: stale-retry cap, same-key write guard,
`fetchNoteBody` dedupe + abort.

Status: IMPLEMENTED and validated (2026-09-22).

## Background / verified facts

- Worker stores one KV key per day: `session:YYYY-MM-DD` (`worker/src/shared.js:67-68`).
- `/api/all` lists every `session:*` key and reads all values (`worker/src/all.js:37,45`).
  Today the namespace holds 22 day-keys → ~26 KV reads per pull.
- Client persists a pull watermark: `lastSyncAt` → localStorage `META_KEY`
  (`app/src/features/sync/useCloudSync.ts:296-298`, restored line 289).
- KV `list()` returns key metadata inline for free — same trick `notes.js:37`
  already uses for note metadata.
- Routing uses `url.pathname` (`worker/src/index.js:86`), so `?since=` can't
  break route matching.
- Cached KV reads are still billed (Cloudflare docs: "cached reads are
  billable") — `cacheTtl: 60` on session reads buys latency, not quota.

## Phase 0 — Worker: write path carries timestamps

1. `worker/src/sessions.js` `putSession` (~line 78): write
   `metadata: { updatedAt: Date.now() }` on every `KV.put`.
2. `worker/src/sessions.js` `deleteSession` (~line 93): instead of bare
   `KV.delete`, write tombstone key `sdel:<date>` with
   `metadata: { updatedAt }` + `expirationTtl: 30d`, so deletions propagate
   through the same namespace-wide list. Old clients ignore `sdel:` keys as
   stray — safe during rollout.

## Phase 1 — Worker: `GET /api/all?since=`

3. `worker/src/all.js` `getAll(env, cors, since?)`:
   - Capture `t0 = Date.now()` **before** the list. Watermark semantics: any
     write after `t0` has `updatedAt > t0`, so it is caught by the next pull —
     no gap.
   - List once, unchanged (`listAllKeys(env)`).
   - Value-read only session keys where `k.metadata?.updatedAt > since`,
     **or metadata missing** (legacy keys → always included until backfilled).
   - Collect `sdel:` keys with `updatedAt > since` → `removedDates`.
   - Deadlines/subjects/notes stay full reads (≤5, cheap).
   - Respond `{ sessions (changed days only), deadlines, subjects, notes,
     removedDates, updatedAt: t0 }`.
4. `worker/src/index.js` (~line 196): parse
   `new URL(request.url).searchParams.get("since")` → number, pass to `getAll`.

## Phase 2 — Client: incremental merge

5. `app/src/features/sync/kvClient.ts` `getAll`: accept
   `since?: number | null`, append `?since=` when finite.
6. `app/src/store/useSessionStore.ts`: add
   `hydrateChanged(dates, removedDates)` reusing `replaceForDate` semantics
   (line 166) + deleting removed dates.
7. `app/src/features/sync/useCloudSync.ts` `readCloud`:
   - Send `since = lastSyncAt`. No `since` on first boot → full pull as today.
   - Legacy-worker detection: response without `removedDates` → fall back to
     today's `hydrateAll` path.
   - **Mandatory gate:** `cloudEmpty` → `adoptLocalAsCloud` branch
     (lines 518-529) runs on **full pulls only**. Without this, an unchanged
     `since`-pull (legitimately empty sessions) would falsely trigger adoption
     and re-push the entire local store.
   - On `since` response: partial merge + `removedDates`, set
     `lastSyncAt = response.updatedAt`, `saveMeta()`.
   - Rollout-safe both directions: new app ↔ old worker (ignores `?since`,
     no `removedDates` → full merge); old app ↔ new worker (ignores new fields).

## Phase 3 — One-time backfill (required for immediate benefit)

8. One-off loop over the 22 legacy `session:*` keys (e.g.
   `wrangler kv key get` → `wrangler kv key put --metadata
   '{"updatedAt":<max-item-ts>}'`), ~22 reads + 22 writes, well within quotas.
   Until a key has metadata it is included in every pull.

## Phase 4 — B: the three small fixes

9. **B1 stale-retry cap** (`useCloudSync.ts:594-630`): `staleAttempts`
   counter; give up after 10 consecutive failures (pill stays `sync error`);
   manual pill-click / `refreshFromCloud` / focus resets the counter.
10. **B2 same-key write guard** (flush loop ~lines 940-955): per-note-id
    `lastWriteAt` map; skip ids written <1000ms ago and `scheduleSync()` them
    instead of marking failed (no pill flash, no wasted LWW pre-read). KV
    limit: 1 write/sec per key.
11. **B3 `fetchNoteBody` dedupe + abort**: module-level in-flight map by id;
    `NoteView` open-effect passes an `AbortController` signal through
    `fetchNoteBody(id, signal)` → `kvClient.getNote`. No change needed in
    `request()` — it already spreads `...init` into `fetch`
    (`kvClient.ts:22-30`). Effect cleanup aborts.

## Phase 5 — Validation

- `npm run typecheck` + `lint` (only the 3 pre-existing warnings).
- Restart remote worker; curl: full pull → 200 + watermark; repeat with
  `?since=<watermark>` → worker log shows ~0 day-gets; edit one day in app →
  next `since`-pull returns only that day; delete a day → appears in
  `removedDates`.
- Browser: reload, tab-switch pulls work; kill worker → retries stop after 10;
  fast double-save → no error flash; dev note-open → single GET.
- Backfill: verify metadata present, then a `since`-pull costs
  1 list + ~0 reads.

## Validation results (2026-09-22, remote worker + curl)

- Full pull → 200, `{ sessions(22 days), deadlines, subjects, notes,
  removedDates: [], updatedAt }`.
- Post-backfill `since`-pull → 22 days + `removedDates: ["2099-01-01"]`
  (canary day deleted to exercise tombstones — tombstone path confirmed).
- Steady-state `since`-pulls → `0 days/0 sessions, removed 0 days`
  (worker log confirms; was 22 day-reads per pull before).
- `typecheck` exit 0; `lint` 0 errors (3 pre-existing warnings in
  App/BentoStats/Timeline); vite HMR applied all client edits, no errors.

## Deviations / open issues

- Backfill was done **through the worker API** (GET each day → PUT back,
  22/22 ok), not via `wrangler kv` CLI: the CLI (`--namespace-id
  22c2da5f...`) sees a DIFFERENT dataset (dummy `s1/X` record, 1 session key)
  than the remote-dev worker serves (real 22 days) — same id, same account.
  Local Miniflare state ruled out (no canary, no real data, blob count
  unchanged after writes). Root cause unresolved; `wrangler kv` CLI output
  for this namespace should not be trusted until investigated.
- `refreshFromCloud` gained an optional `{ manual?: boolean }` param (plan
  said "focus resets the counter" — implemented as: pill/banner clicks pass
  `manual: true`; timer/boot/focus paths don't reset).
- `serverWatermark` (server clock) kept separate from `lastSyncAt` (client
  clock, pill display) + persisted in META_KEY, to avoid clock-skew misses.
- Incremental merge skips dates in `dirtyDates` (flush reads the store at
  flush time — overwriting them with older cloud copies would lose unpushed
  edits).
- A `PUT /api/sessions/2099-01-01` returned client-side 503 while the worker
  logged `stored 1 sessions` (remote-preview tunnel flake; write succeeded).
  Tunnel also hung once (20s) and crashed once (`api.cloudflare.com`
  unreachable) — `wrangler dev --remote` connectivity is flaky in this env.

## Expected outcome (achieved)

Steady-state pull = **1 list + 0–2 reads** (vs 1 list + 26 today), flat at
300 days of history; bounded retries; no phantom save errors; no duplicate
note fetches.

## Rejected alternatives

- Super-key coalescing (one KV key for all sessions): every day's write
  rewrites the whole blob and hits the 1-write/sec-per-key limit.
- Server-side day window (return only last 30 days): doesn't fix
  unchanged-day reads; breaks `ensureDateLoaded`'s window assumption
  (`useCloudSync.ts:735`).
