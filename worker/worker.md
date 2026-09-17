# Worker API — Frontend Developer Guide

Everything a frontend dev needs to call the Study Plan backend correctly. No internal architecture, no KV layout, no security notes — just the contract.

---

## 1. Where it lives

| Environment | URL |
| --- | --- |
| Production | `https://study-plan.iankoley04.workers.dev` |
| Local dev (`wrangler dev`) | `http://localhost:8787` |
| Token (in code) | `DEFAULT_WORKER_URL` constant in `index.html` |
| Token (auth) | User enters in the gear-icon settings modal → saved to `localStorage.studyplan_config` |

The frontend never sends the URL to the worker — it's hardcoded. The user only types the **secret token**.

---

## 2. Every request needs this

```http
Authorization: Bearer <SECRET_TOKEN>
Content-Type: application/json    # only for PUT
```

`SECRET_TOKEN` is the long random string the user generated when setting up the worker. It's a Cloudflare Worker secret — never commit it, never log it.

If the token is wrong or missing → **401 Unauthorized**.
If the request comes from a browser tab the worker doesn't recognize → **403 Forbidden** (CORS).
If the browser blocks reading the response, the failure shows up as a network error in DevTools (the worker has a CORS allowlist of `null, https://study-qsk.pages.dev, https://study.anindya.online`).

---

## 3. Endpoints

### `GET /api/ping` — health check

```http
GET /api/ping
```

Response:
```json
{ "ok": true, "ts": 1717770000000 }
```

Use this in the "Test connection" button in settings. The frontend doesn't read the body — it just checks the request didn't 4xx.

---

### Sessions — one KV key per calendar day

**Key shape:** `session:YYYY-MM-DD` → `{ sessions: [ ... ] }`

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/sessions` | — | `{ dates: ["2026-06-06", ...], listComplete: true }` |
| GET | `/api/sessions-all` | — | `{ sessions: {date: [...]}, updatedAt }` |
| GET | `/api/sessions/:date` | — | `{ sessions: [...], updatedAt }` or **404** |
| PUT | `/api/sessions/:date` | `{ sessions: [...] }` | `{ ok, updatedAt, sessions }` |
| DELETE | `/api/sessions/:date` | — | `{ ok }` |

`:date` must match `YYYY-MM-DD`. Server rejects other formats with **400**.

#### A session object

```json
{
  "id":        "lwn2a8c4jk12x",
  "time":      "09:30",
  "duration":  60,
  "subject":   "Math",
  "topic":     "Linear algebra",
  "color":     "#ff5a3c",
  "status":    "pending",
  "updatedAt": 1717770000000
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Client-generated. Stable across edits. Required for stable sync. |
| `time` | string | "HH:MM" 24-hour. |
| `duration` | number | Minutes. |
| `subject` | string | Non-empty. |
| `topic` | string | Free text. |
| `color` | string | CSS hex. |
| `status` | string | `"pending"` \| `"done"` \| `"notdone"`. Legacy rows with `done: boolean` are normalized on read. |
| `updatedAt` | number | **Unix ms.** Bump on every edit. Used for conflict resolution. |
| `focusedSeconds` | number (optional) | Actual focus time from focus mode. Preserved through sync. |

**PUT is authoritative.** Whatever you PUT becomes the new state for that date. Items not in the body are removed. So:

- Add a session → PUT the full list (with the new one)
- Delete a session → PUT the full list (without it)
- Toggle done → PUT the full list (with the toggled `done` and a new `updatedAt`)

There is no PATCH. The client is expected to keep the full list locally and replace.

**GET `/api/sessions-all` is the boot endpoint.** The frontend calls it on page load, behind a
loading gate, and **REPLACE**s its local copy with the response — cloud is the source of truth and
localStorage is only a cache. If the cloud fetch fails, the cached copy stays on screen with an
explicit "offline, showing cache" state, and edits queue up for later.

The one exception is **first-writer adoption**: a device that has never completed a pull before
(no `lastCloudAt` in `localStorage.studyplan_sync_meta`) that holds data while the cloud is empty
pushes its data up instead of being wiped. After that first sync, an empty cloud genuinely means
empty, and the local copy is replaced.

Deadlines work the same way (`GET /api/deadlines` → replace `localStorage.studyplan_deadlines`),
except the PUT is last-write-wins per item rather than a whole-collection replace.

> **Before this adoption rule existed**, connecting a device with pre-existing local data to an
> empty account destroyed that data on the first boot. The gate is `lastCloudAt == null`.

---

### Deadlines — one KV key per deadline, with auto-expiry

**Key shape:** `deadline:{id}` → bare object. **KV TTL is set to `dueDate + 3 days`** — deadlines auto-vanish from the worker after 3 days past due, no client cleanup needed.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/deadlines` | — | `{ items: [...], updatedAt }` |
| PUT | `/api/deadlines/:id` | `{ id, title, dueDate, source, status, createdAt, updatedAt }` | `{ ok, expiresAt }` or `{ ok: false, stale: true, item }` |
| DELETE | `/api/deadlines/:id` | — | `{ ok }` |

#### A deadline object

```json
{
  "id":        "lwn2b3p4qm99z",
  "title":     "CS101 Lab 3",
  "dueDate":   "2026-06-10",
  "source":    "manual",
  "status":    "pending",
  "createdAt": 1717770000000,
  "updatedAt": 1717770000000
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Client-generated. URL's `:id` wins if body's `id` differs. |
| `title` | string | Non-empty. |
| `dueDate` | string | "YYYY-MM-DD". Used for TTL and sort order. |
| `source` | string | `"manual"` (UI) or `"gmail"` (future). Worker doesn't filter on it. |
| `status` | string | `"pending"` \| `"done"` \| `"notdone"`. Legacy `done: boolean` normalized on read. |
| `createdAt` | number | **Unix ms.** Set once on insert. |
| `updatedAt` | number | **Unix ms.** Bumped on every edit. Drives last-write-wins. |

**PUT is last-write-wins per item.** The worker compares `updatedAt` against the
stored copy; an older write is rejected with **200** `{ ok: false, stale: true, item }`
where `item` is the stored winner. A newer (or equal) write replaces the item.
So a stale client can never clobber a newer edit — but it also won't get a 4xx,
so check the response body if you need to know which copy won.

**PUT also accepts `id` in the URL only** — if the body lacks `id`, the URL's id is used. The server always returns the canonical id (URL's).

`expiresAt` in the PUT response is in **seconds** (KV's `expiration` field). The frontend currently doesn't use it.

**DELETE is idempotent** — deleting a non-existent id returns `{ ok: true }`. The frontend uses this for "auto-remove 3 days past due" without first checking existence.

---

## 4. Error responses (all the frontend ever needs to know)

| Status | When | Body | Frontend does |
| --- | --- | --- | --- |
| 200 | success | JSON | Read the body |
| 204 | CORS preflight (OPTIONS only) | empty | Browser handles |
| 400 | bad input (bad JSON, bad date, missing fields) | plain text | Treat as a bug — log it, fall back to local |
| 401 | bad/missing token | `Unauthorized` | Prompt user to re-enter token in settings |
| 403 | origin not in allowlist | `Forbidden: origin not allowed` | Same as 401 — token works, but browser can't read it |
| 404 | `GET /api/sessions/:date` for an unknown date | `no sessions for that date` | Treat as "empty" — the frontend already handles null/undefined |
| 405 | wrong method (e.g., POST /api/ping) | `Method not allowed` | Log as bug |
| 413 | body > 256 KB | `Payload too large` | Shouldn't happen — log as bug |

The worker's `_fetch` helper in `index.html` already handles all of these:
- **204/404** → returns `null` (caller treats as "empty")
- **Other 4xx/5xx** → throws `new Error(status + body)`
- **5xx and network errors** → re-queued with a 4-second retry

---

## 5. The data flow on the frontend

```
┌──────────────┐
│  page load   │
└──────┬───────┘
       │ 1. migrate localStorage (add id/updatedAt to old items) — only relevant when cloud is NOT configured
       │ 2. GET /api/sessions-all
       │ 3. REPLACE localStorage with cloud response (no merge — cloud is authoritative)
       │ 4. GET /api/deadlines
       │ 5. REPLACE localStorage deadlines with cloud response
       │ 6. render
       │
       ▼
┌──────────────────┐
│  user edits      │── save(data, date) ──▶ localStorage + markSessionDirty(date)
└──────────────────┘                                          │
                                                              │ 800ms debounce
                                                              ▼
                                            ┌──────────────────────────┐
                                            │ PUT /api/sessions/:date  │
                                            │ body = localStorage[date]│
                                            └──────────────────────────┘
```

For deadlines:

```
add/edit  →  saveDeadlines(arr, id, 'put')    →  PUT  /api/deadlines/:id
delete    →  saveDeadlines(arr, id, 'delete') →  DELETE /api/deadlines/:id
                                                            │
                                              800ms debounce, 4s retry on fail
```

The frontend already has all of this wired up. The endpoints above are the contract.

---

## 6. What the worker does NOT do

- **No versioning** — there's no `/api/v1/`. If we ever break the contract, add a version segment.
- **No real-time** — no WebSocket / SSE. Sync is HTTP request/response, debounced.
- **No per-user separation** — single bearer token = single user. Not multi-tenant.
- **No rate limiting** — fine for personal use.
- **No request signing** — TLS + bearer token is the only auth.
- **Conflict handling is split by entity:**
  - *Deadlines* — last-write-wins **server-side**, per item, by `updatedAt`.
  - *Sessions* — `PUT /api/sessions/:date` still **replaces** the whole day. The client
    avoids clobbering by re-reading the day and merging by `updatedAt` *before* pushing.
    Deletions are expressed as absence from the list, which is why the merge can't live
    server-side without tombstones.

---

## 7. Quick smoke test (curl)

Replace `$URL` and `$TOKEN`:

```bash
# health
curl -sS -H "Authorization: Bearer $TOKEN" $URL/api/ping

# list dates
curl -sS -H "Authorization: Bearer $TOKEN" $URL/api/sessions

# full snapshot
curl -sS -H "Authorization: Bearer $TOKEN" $URL/api/sessions-all

# put a test session on today
TODAY=$(date -u +%Y-%m-%d)
curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessions":[{"id":"test1","time":"09:00","duration":60,"subject":"Test","topic":"smoke","color":"#ff5a3c","done":false,"updatedAt":1717770000000}]}' \
  $URL/api/sessions/$TODAY

# read it back
curl -sS -H "Authorization: Bearer $TOKEN" $URL/api/sessions/$TODAY

# delete the day
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" $URL/api/sessions/$TODAY
```

Expected: 200s and `{"ok":true}` or the data you PUT. The `-sS` flag silences the progress bar but still prints errors.

---

## 8. TL;DR for a frontend dev

You don't need to read the worker source to call it. Just:

- **Auth header on every request:** `Authorization: Bearer <user's token>`
- **9 endpoints** in the two tables above
- **Five data shapes:** `Session`, `Deadline`, `DateList`, `SessionAll`, `DeadlineList`
- **All times are Unix milliseconds except `expiresAt` (seconds)** and `dueDate` ("YYYY-MM-DD" string)
- **All ids are client-generated** — generate once, never change
- **PUT replaces the day, it doesn't merge** — send the full list. The client merges by `updatedAt`
  *before* pushing, and carries local deletions as tombstones so the merge doesn't resurrect them.
- **Cloud is the source of truth** — on boot the client reconciles the local copy with the cloud
  response. A device with cached data paints it immediately and refreshes in the background
  (stale-while-revalidate); only a device with nothing cached waits on the first read. A fetch
  failure leaves the cache visible, names the reason, and retries on a capped backoff. First-ever
  sync from a device holding data against an empty cloud pushes instead (see §3).

If you have to add a feature that needs the worker to do something new, the cleanest path is to add a new endpoint in `src/index.js` + a new file in `src/`. Don't modify the existing endpoints without bumping the API version.
