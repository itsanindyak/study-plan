# Study Plan — Cloudflare Worker Backend

Personal cloud sync for the Study Plan app. Stores sessions + deadlines in Cloudflare KV, authenticated with a bearer token. Free tier is plenty for personal use.

## Folder structure

```
worker/
├── package.json          # wrangler as a dev dep
├── wrangler.jsonc        # worker config (KV binding, ALLOWED_ORIGINS)
├── .dev.vars.example     # local-only secrets template
├── .gitignore
└── src/
    ├── index.js          # main fetch handler + route dispatch
    ├── shared.js         # CORS, auth, response, KV keys, TTL, sanitizers
    ├── sessions.js       # session route handlers
    ├── deadlines.js      # deadline route handlers
    ├── subjects.js       # subject catalog route handlers
    ├── notes.js          # notepad route handlers
    └── all.js            # single-request whole-plan snapshot
```

## API

All endpoints require `Authorization: Bearer <SECRET_TOKEN>`. CORS is allowlist-only (env `ALLOWED_ORIGINS`).

### Sessions — one KV key per day

`session:YYYY-MM-DD` → `{ sessions: [{id, time, duration, subject, topic, color, done, updatedAt}] }`

| Method   | Path                       | Body                  | Returns                                        |
| -------- | -------------------------- | --------------------- | ---------------------------------------------- |
| `GET`    | `/api/sessions`            | —                     | `{ dates: ["2026-06-06", ...] }`               |
| `GET`    | `/api/sessions-all`        | —                     | `{ sessions: {date: [...]}, updatedAt }`                       |
| `GET`    | `/api/sessions/:date`      | —                     | `{ sessions: [...], updatedAt }` or 404                        |
| `PUT`    | `/api/sessions/:date`      | `{ sessions: [...] }` | `{ ok, updatedAt, sessions }` (body is authoritative)          |
| `DELETE` | `/api/sessions/:date`      | —                     | `{ ok }`                                       |

### Deadlines — one KV key per id, with TTL

`deadline:{id}` → `{ id, title, dueDate, source, done, createdAt }` (KV key has TTL = `dueDate + 3 days`)

| Method   | Path                  | Body                                                            | Returns                       |
| -------- | --------------------- | --------------------------------------------------------------- | ----------------------------- |
| `GET`    | `/api/deadlines`      | —                                                               | `{ items: [...], updatedAt }` |
| `PUT`    | `/api/deadlines/:id`  | `{ id, title, dueDate, source, done, createdAt }`               | `{ ok, expiresAt }`           |
| `DELETE` | `/api/deadlines/:id`  | —                                                               | `{ ok }`                      |

### Subjects — one KV key per id, the catalog (no TTL)

`subject:{id}` → `{ id, name, color, createdAt, updatedAt }`

The subject catalog is shared across sessions on every day. Sessions store the
subject *name* (not an id), and their color is resolved at render time from the
catalog — so recoloring a subject updates every block instantly with no writes.
Renames only affect future sessions; deleting a subject leaves existing sessions
unaffected (they keep their stored color).

| Method   | Path                  | Body                                            | Returns                                          |
| -------- | --------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `GET`    | `/api/subjects`       | —                                               | `{ items: [...], updatedAt }`                    |
| `PUT`    | `/api/subjects/:id`   | `{ id, name, color, createdAt, updatedAt }`     | `{ ok }` or `{ ok: false, stale: true, item }`   |
| `DELETE` | `/api/subjects/:id`   | —                                               | `{ ok }`                                         |

The client enforces case-insensitive unique names. The server does not (single-user, no KV name index).

### Notes — one KV key per note, the notepad (no TTL)

`note:{id}` → `{ id, title, snippet, text, createdAt, updatedAt }`

A free-form scratchpad. The title/snippet are derived from the body's first
lines at save time and also ride in the key's **KV metadata**, so listing notes
is a single `list` operation that reads no values. Bodies are capped at 64 KB.
The list returns metadata only, sorted newest-updated first; opening a note
(`GET /api/notes/:id`) fetches just that body.

| Method   | Path                | Body                                                    | Returns                                        |
| -------- | ------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `GET`    | `/api/notes`        | —                                                       | `{ items: [meta...], updatedAt }`              |
| `GET`    | `/api/notes/:id`    | —                                                       | `{ note: {...}, updatedAt }` or 404            |
| `PUT`    | `/api/notes/:id`    | `{ id, title, snippet, text, createdAt, updatedAt }`     | `{ ok }` or `{ ok: false, stale: true, item }` |
| `DELETE` | `/api/notes/:id`    | —                                                       | `{ ok }`                                       |

### Other

| Method | Path         | Returns         |
| ------ | ------------ | --------------- |
| `GET`  | `/api/ping`  | `{ ok, ts }`    |
| `GET`  | `/api/all`   | whole-plan snapshot, see below |

`GET /api/all` returns `{ sessions, deadlines, subjects, notes, updatedAt }` in
one request — the worker does a single namespace-wide `list` plus one `get` per
value key. This is what a full pull uses, because the KV free tier allows only
1,000 `list` requests/day while reads are 100,000/day. Clients fall back to the
four per-collection requests when it 404s (older worker).

### Conflict resolution

`PUT /api/sessions/:date` is **authoritative**: the body's list replaces the server's list for that date. Items in body are stored, items not in body are dropped (handles deletes cleanly).

`bootFromCloud` on the client does a per-item merge by `updatedAt` so the local state has the latest combined view before any PUT, so concurrent multi-device edits converge.

## One-time setup (5 minutes)

### 1. Create a Cloudflare account
If you don't have one: https://dash.cloudflare.com/sign-up (free).

### 2. Login wrangler from this folder

```powershell
cd D:\project\study-plan\worker
npx wrangler login
```
A browser tab opens; click "Allow". This links your machine to your Cloudflare account.

### 3. Create a KV namespace

```powershell
npx wrangler kv namespace create STUDY_KV
```

It prints something like:
```
🌀 Creating namespace with title "STUDY_KV"
✨ Success! Created namespace: a1b2c3d4e5f6...
```

Copy the `id` value and paste it into `wrangler.jsonc` replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

### 4. Pick and set your secret token

Generate a long random string (don't reuse passwords). Easiest in PowerShell:

```powershell
[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
```

Then set it as a secret (it'll prompt you to paste it):

```powershell
npx wrangler secret put SECRET_TOKEN
```

Or pipe from a file so it doesn't go in your shell history:

```powershell
"YOUR_LONG_RANDOM_STRING" | npx wrangler secret put SECRET_TOKEN
```

### 5. Deploy

```powershell
npx wrangler deploy
```

Output:
```
Total Upload: 3.85 KiB / gzip: 1.37 KiB
Worker Startup Time: 5ms
Uploaded study-plan (1.23 sec)
Deployed study-plan triggers (0.45 sec)
  https://study-plan.YOUR-SUBDOMAIN.workers.dev
Current Version ID: ...
```

Copy that URL — it's what you'll paste into the app's Cloud Settings.

### 6. Test from the command line

```powershell
curl https://study-plan.YOUR-SUBDOMAIN.workers.dev/api/ping `
  -H "Authorization: Bearer YOUR_LONG_RANDOM_STRING"
```

Should return `{"ok":true,"ts":...}`.

## Connect the app

1. Open `index.html` in any browser (or host it anywhere)
2. Click the gear icon (top right) → **Cloud sync**
3. Paste:
   - **Worker URL:** `https://study-plan.YOUR-SUBDOMAIN.workers.dev`
   - **Secret token:** the random string you set
4. Click **test** → "connection works ✓"
5. Click **connect** → "connected ✓"

The sync pill (top right) goes green and shows `synced`. From now on:
- Every change is saved locally AND pushed to KV
- Opening the page re-reads KV behind a loading gate before anything is shown
- A device connecting for the first time with data of its own, against an empty account, uploads
  that data rather than being wiped by the empty cloud
- The Worker is the source of truth; localStorage is the offline cache, and the app says so when
  it is serving you that cache

## Local development

```powershell
npx wrangler dev
```

Runs at `http://localhost:8787` with a local KV simulator. To use real KV from `dev`, add `remote: true` to the binding in `wrangler.jsonc`.

For local secrets, copy `.dev.vars.example` → `.dev.vars` and put your real (or a dev) token in there. Never commit `.dev.vars`.

## View logs

```powershell
npx wrangler tail
```

Streams all requests — useful when debugging a sync issue from a phone.

## Free tier limits

- **Workers:** 100,000 requests/day
- **KV:** 100,000 reads/day, 1,000 writes/day, 1 GB storage

A personal planner uses maybe 50 requests/day. You will never hit the limit.

## Troubleshooting

| Symptom                                       | Fix                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `401 Unauthorized` in app status              | Token mismatch. Re-set with `wrangler secret put SECRET_TOKEN`, update in app. |
| `404 Not found`                               | Worker URL wrong or you deployed under a different name. Re-run `wrangler deploy` and check. |
| App stuck on `syncing…`                       | Network or token issue. Click the pill → opens settings → Test connection.     |
| Want to start fresh                           | `npx wrangler kv key delete --namespace-id <ID> "data"` to wipe, then reconnect app. |
| Change Worker KV ID                           | Update `wrangler.jsonc`, run `wrangler deploy` again.                          |
