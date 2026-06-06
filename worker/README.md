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
    └── deadlines.js      # deadline route handlers
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

### Other

| Method | Path         | Returns         |
| ------ | ------------ | --------------- |
| `GET`  | `/api/ping`  | `{ ok, ts }`    |

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
4. Click **Test connection** → "connection works ✓"
5. Click **Save & sync** → "synced from cloud ✓"

The sync pill (top right) will go green and show `synced`. From now on:
- Every change is saved locally AND pushed to KV
- Opening the page on another device fetches the latest data
- The Worker is the source of truth; localStorage is the offline cache

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
