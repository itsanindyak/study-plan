# Worker — Issues & Flaws

Found during a project-manager review of `worker/src/`. Severity is **Critical / High / Medium / Low**. None of these break the documented functionality, but they should be fixed before the worker is exposed beyond personal use.

---

## C1. Body size check is bypassable via chunked encoding

**Severity:** High — **FIXED** in `src/index.js:32-49`
**File:** `src/index.js:32-43` → `src/index.js:32-49`
**Symptom:** A client can send a request larger than 256 KB by omitting the `Content-Length` header (chunked transfer encoding), and the `readJsonBody` check passes.

```js
// OLD
const len = parseInt(request.headers.get("Content-Length") || "0", 10);
if (len > MAX_BODY_BYTES) { ... }
```

`Content-Length` is **0** when absent, so the check is skipped. Cloudflare's runtime caps request body at 100 MB, but a personal planner should not need 100 MB.

**Fix applied:** `readJsonBody` now reads the body as text first, then enforces the size limit on the actual payload, then JSON-parses. The check is no longer dependent on the `Content-Length` header — chunked-encoding clients are caught too.

```js
let text;
try { text = await request.text(); }
catch { return { error: errResponse(400, "Could not read body", cors) }; }
if (text.length > MAX_BODY_BYTES) {
  return { error: errResponse(413, "Payload too large", cors) };
}
try { return { body: JSON.parse(text) }; }
catch { return { error: errResponse(400, "Invalid JSON", cors) }; }
```

---

## C2. `decodeURIComponent` throws on malformed path segments

**Severity:** High — **FIXED** in `src/index.js:51-54, 96-97, 116-117`
**File:** `src/index.js:85, 104` → `src/index.js:51-54, 96-97, 116-117`
**Symptom:** A request like `GET /api/sessions/%FF` throws `URIError: URI malformed`. The worker returns 500 instead of a clean 4xx.

```js
// OLD
const date = decodeURIComponent(path.slice("/api/sessions/".length));
```

**Fix applied:** Added a `safeDecode` helper and used it on both path segments:

```js
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

// usage
const date = safeDecode(path.slice("/api/sessions/".length));
if (date === null) return errResponse(400, "bad path encoding", cors);
```

`%FF` and similar malformed URI sequences now get a clean **400** with `"bad path encoding"` instead of a 500.

---

## C3. `null` origin in CORS allowlist is broad

**Severity:** Medium
**File:** `src/shared.js:31-37`, `wrangler.jsonc:10`
**Symptom:** The `null` origin is the value the browser sends for:
- `file://` pages
- sandboxed iframes (`<iframe sandbox src="...">`)
- some redirected requests
- `data:` URIs
- certain CORS-misconfigured sites

This means **any web page can make CORS requests to the worker** as long as it triggers a `null` Origin. The bearer token still protects the data, but a successful response can be read by any origin if the token leaks.

For personal use (opening `index.html` via `file://`) this is the only way to get the app working. Long-term, host the app and remove `null` from the allowlist.

**Fix options:**
1. Keep `null` but document the risk in `worker.md`.
2. Switch to a local dev workflow that doesn't need `file://` (e.g., `python -m http.server`).
3. Add per-origin rate limiting.

---

## H1. Date format check is format-only

**Severity:** Medium — **FIXED** in `src/index.js:32-39, 107`
**File:** `src/index.js:30, 86` → `src/index.js:32-39, 107`
**Symptom:** The regex `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-13-45`, `2026-00-32`, `2026-02-30`. The KV key is created with that bogus date and pollutes the namespace.

**Fix applied:** New `isValidDate()` helper parses the string as `YYYY-MM-DDT00:00:00Z`, then confirms `toISOString().slice(0, 10)` round-trips back to the same string. Bogus months/days fail the round-trip and are rejected with **400 `bad date (expected YYYY-MM-DD)`** before they reach KV.

```js
function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
```

Used in the `/api/sessions/` route guard so `GET` / `PUT` / `DELETE` on a bogus date all 400 cleanly.

---

## H2. No application logging

**Severity:** Medium — **FIXED** across `src/sessions.js`, `src/deadlines.js`
**File:** all of `src/` → see each call site below
**Symptom:** When something goes wrong in production (token mismatch, KV error, sanitizer rejects 100% of items), there are no `console.log` / `console.error` calls. `wrangler tail` only shows the access log via observability, not internal state.

**Fix applied:** Added structured logs to every write path and to the list endpoints. `wrangler tail` (or the Cloudflare dashboard) will now show:

- `listSessionDates: N dates`
- `getAllSessions: N days, M sessions`
- `putSession[<date>]: stored N sessions` (or `dropped K invalid items` if any sanitizers failed)
- `putSession[<date>]: rejected — body must be { sessions: [...] }` (warn)
- `putSession[<date>]: all K items failed sanitize` (warn)
- `deleteSession[<date>]`
- `listDeadlines: N of M keys` (M = total key count, N = non-null)
- `putDeadline[<id>]: title="..." dueDate=... expiresAt=...`
- `putDeadline[<id>]: rejected — missing title or dueDate` (warn)
- `deleteDeadline[<id>]`

Token-related failures stay silent (no token content is ever logged).

---

## H3. KV list pagination is not handled

**Severity:** Medium — **FIXED** in `src/shared.js:76-86`, used in `src/sessions.js:17, 28` and `src/deadlines.js:16`
**File:** `src/sessions.js:14-18, 22-36` and `src/deadlines.js:14-22`
**Symptom:** `env.STUDY_KV.list({ prefix })` returns up to 1000 keys per call. The current code only reads the first page. If a user has more than 1000 days of data (≈ 2.7 years of sessions), `list_complete: false` is returned but the frontend never checks it.

**Fix applied:** New `listAllKeys(env, prefix)` helper in `src/shared.js` loops on `cursor` until `list_complete` is true, accumulating every key. Used by:

- `listSessionDates` — paginates dates
- `getAllSessions` — paginates dates and fetches all values
- `listDeadlines` — paginates deadlines

```js
export async function listAllKeys(env, prefix) {
  const all = [];
  let cursor;
  do {
    const opts = { prefix };
    if (cursor) opts.cursor = cursor;
    const page = await env.STUDY_KV.list(opts);
    all.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return all;
}
```

`/api/sessions` now always returns `listComplete: true` because we exhaust the cursor loop before responding.

---

## M1. Token comparison is not constant-time

**Severity:** Low
**File:** `src/shared.js:41-46`
**Symptom:** `token === env.SECRET_TOKEN` in JavaScript is **not guaranteed** to be constant-time. In theory, an attacker could time the response to guess the token byte-by-byte. In practice, Cloudflare Workers' runtime is JIT-compiled and string comparison short-circuits, but the standard library provides `crypto.subtle.timingSafeEqual` for a reason.

**Fix:** Use `crypto.subtle.timingSafeEqual`:

```js
import { timingSafeEqual } from "node:crypto";  // not available in workers!
// Workers don't have timingSafeEqual directly. Manual fallback:
function constantTimeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

For a personal-use worker behind a bearer token, this is **low priority**. The token is long enough that timing attacks are impractical over the network.

---

## M2. `expiresAt` unit ambiguity

**Severity:** Low
**File:** `src/deadlines.js:30-37`
**Symptom:** The PUT deadline response is `{ ok, expiresAt }`. `expiresAt` is in **seconds** (matching KV's `expiration` parameter convention). The frontend doesn't use it, but a future frontend dev will reach for it and assume milliseconds (the convention everywhere else in the API).

**Fix:** Either return in milliseconds:

```js
return json({ ok: true, expiresAt: expiresAt * 1000 }, 200, cors);
```

Or document the unit clearly in the field name. Or remove the field if the frontend doesn't use it.

---

## M3. `errResponse` returns plain text bodies

**Severity:** Low
**File:** `src/shared.js:57-59`
**Symptom:** Error responses are `Content-Type: text/plain` (or whatever default). The frontend's `cloud._fetch` does `res.text()` and stuffs it into `Error.message`, so the user sees `"401 Unauthorized"`. That's fine, but mixing JSON success bodies with plain-text error bodies is inconsistent.

**Fix:** Return JSON for errors too:

```js
export function errResponse(status, msg, cors) {
  return json({ error: msg, status }, status, cors);
}
```

Or: `Content-Type: text/plain; charset=utf-8` explicitly. Either way, be consistent.

---

## M4. No `Cache-Control: no-store` on responses

**Severity:** Low
**File:** `src/shared.js:50-55`
**Symptom:** The browser, service workers, or intermediaries can cache the GET responses (`/api/sessions-all`, `/api/deadlines`). If the user opens the page on device A, then edits on device B, then refreshes A, A might serve the cached response and miss B's changes.

**Fix:** Add `Cache-Control: no-store` to all JSON responses in `corsHeadersFor`. The frontend already sends `cache: 'no-store'` on every `fetch`, but a defensive header is cheap.

---

## M5. Deadline DELETE has no auth-or-existence check

**Severity:** Low (intentional)
**File:** `src/deadlines.js:39-43`
**Symptom:** Any authenticated client can `DELETE /api/deadlines/:id` for any id, even one that doesn't exist. The response is `{ ok: true }` either way.

This is **correct** for an idempotent API, and the frontend relies on it (cleanupDeadlines issues DELETE without first checking). Just noting that this is intentional. No fix needed.

---

## L1. Dead code: `MAX_BODY_BYTES` is exported but only used once

**Severity:** Low
**File:** `src/shared.js:5, src/index.js:14`
**Note:** `MAX_BODY_BYTES` is exported from `shared.js` and imported in `index.js`. This is fine — it's a config knob and may be reused when the body-size fix lands (see C1).

---

## L2. `wrangler.jsonc` has no `preview_id` for KV

**Severity:** Low
**File:** `wrangler.jsonc:12-17`
**Note:** When you run `wrangler dev`, the local KV is a simulator, not a connection to the production namespace. To use real KV from `wrangler dev`, add `"remote: true` to the binding (it'll work but slower). Currently the dev environment is isolated, which is correct for safety but surprises first-time users. Add a note to `README.md`.

---

## L3. No CI / lint / format config

**Severity:** Low
**File:** worker root
**Note:** No `.eslintrc`, no `prettier.config.js`, no GitHub Actions. For a personal project, fine. If this worker is shared with anyone else, add at least `prettier` and a `lint` npm script.

---

## Summary by severity

| Severity | Count | IDs |
| --- | --- | --- |
| ~~Critical~~ | ~~2 — fixed~~ | C1, C2 |
| ~~High~~ | ~~3 — fixed~~ | H1, H2, H3 |
| Medium | 1 | C3 |
| Low | 5 | M1–M5, L1–L3 |

**Status:** All Critical (C1, C2) and High (H1, H2, H3) bugs are **fixed** in the source. The wrangler dev server on port 8787 will pick up the changes on the next request. To push to production (`https://study-plan.iankoley04.workers.dev`), run `npx wrangler deploy` from `D:\project\study-plan\worker`.

**Remaining:** C3 (broad `null` origin) and the 5 low-severity items (M1–M5, L1–L3). None are blockers for personal use. C3 only matters if the token leaks; the low items are hardening for shared use.

---

## Is the worker working as per plan?

**Yes — for the documented functionality.**

- ✅ Sessions stored as `session:YYYY-MM-DD` → `{ sessions: [...] }` — one KV key per day
- ✅ Deadlines stored as `deadline:{id}` → bare object — one key per id, with TTL = `dueDate + 3 days` (absolute `expiration`, no 28-day cap)
- ✅ Bearer token auth via `Authorization: Bearer <SECRET_TOKEN>`
- ✅ CORS allowlist via `ALLOWED_ORIGINS` env var; `null` is allowed for `file://`
- ✅ Per-day replace on PUT (no implicit keep of stale server items — the bug you reported is fixed)
- ✅ TTL uses `expiration` (absolute) so deadlines can be > 28 days in the future
- ✅ `/api/ping` for health check
- ✅ All routes return proper status codes (200, 400, 401, 403, 404, 405, 413)
- ✅ Input sanitization on every write
- ✅ Frontend's expected response shapes all match (verified by `grep` against `index.html`)

**Not yet on production:** The latest fixes (per-day replace, migrate.js removal) are in the source files but not redeployed. The dev server on port 8787 has them, but `https://study-plan.iankoley04.workers.dev` still has the old merge logic. Run `npx wrangler deploy` to push.
