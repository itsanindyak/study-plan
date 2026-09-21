// Shared utilities: CORS, auth, response helpers, KV key/TTL utils, sanitizers.

export const SESSION_PREFIX = "session:";
export const DEADLINE_PREFIX = "deadline:";
export const SUBJECT_PREFIX = "subject:";
export const MAX_BODY_BYTES = 256 * 1024; // 256 KB per request — plenty for a personal planner

// ─── CORS / origin ────────────────────────────────────────────

export function allowedOrigins(env) {
  return new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function corsHeadersFor(request, env) {
  const origin = request.headers.get("Origin");
  const set = allowedOrigins(env);
  const allowOrigin = origin && (set.has("*") || set.has(origin)) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function originAllowed(request, env) {
  // Curl / server-to-server requests send no Origin — they bypass CORS.
  // The bearer token is the real security boundary for those.
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const set = allowedOrigins(env);
  return set.has("*") || set.has(origin);
}

// ─── auth ─────────────────────────────────────────────────────

export function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!env.SECRET_TOKEN) return false; // server misconfigured
  return token.length > 0 && token === env.SECRET_TOKEN;
}

// ─── response helpers ─────────────────────────────────────────

export function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...(cors || {}), "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errResponse(status, msg, cors) {
  return new Response(msg, { status, headers: cors || {} });
}

// ─── KV key helpers ───────────────────────────────────────────

export function sessionKey(date) {
  return SESSION_PREFIX + date;
}
export function deadlineKey(id) {
  return DEADLINE_PREFIX + id;
}
export function subjectKey(id) {
  return SUBJECT_PREFIX + id;
}
export function dateFromSessionKey(k) {
  return k.slice(SESSION_PREFIX.length);
}

// ─── KV pagination ────────────────────────────────────────────
// KV.list returns at most 1000 keys per call. Loop until list_complete is
// true so the caller gets every key under the prefix, regardless of size.
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

// ─── TTL: absolute expiration, no 28-day cap ─────────────────

export function computeExpiration(dueDate) {
  const dueMs = Date.parse(dueDate);
  // bad/unparseable date → purge in 60s rather than store garbage
  if (Number.isNaN(dueMs)) return Math.floor(Date.now() / 1000) + 60;
  // delete at dueDate + 3 days
  const deleteAtSec = Math.floor((dueMs + 3 * 86400 * 1000) / 1000);
  // KV minimum expiration is 60s from now
  return Math.max(Math.floor(Date.now() / 1000) + 60, deleteAtSec);
}

// ─── id generator ─────────────────────────────────────────────

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── tri-state status ─────────────────────────────────────────

const VALID_STATUS = new Set(["pending", "done", "notdone"]);

// Records written before the tri-state change carry `done: boolean`.
// Map those (done:true → "done", done:false → "pending") so old KV data
// keeps working, and treat anything unrecognized as "pending".
export function normalizeStatus(rec) {
  if (rec && typeof rec === "object") {
    if (typeof rec.status === "string" && VALID_STATUS.has(rec.status)) {
      return rec.status;
    }
    if (rec.done === true) return "done";
  }
  return "pending";
}

// Normalize a record read back from KV: always returns `status` and drops
// the legacy `done` field so older stored rows migrate transparently.
export function normalizeRecord(rec) {
  if (!rec || typeof rec !== "object") return rec;
  const { done, ...rest } = rec;
  return { ...rest, status: normalizeStatus(rec) };
}

// ─── sanitizers ───────────────────────────────────────────────

export function sanitizeSession(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.subject !== "string") return null;
  const out = {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    time: typeof s.time === "string" ? s.time : "09:00",
    duration: Number.isFinite(+s.duration) && +s.duration > 0 ? +s.duration : 60,
    subject: s.subject,
    topic: typeof s.topic === "string" ? s.topic : "",
    color: typeof s.color === "string" ? s.color : "#6366f1",
    status: normalizeStatus(s),
    updatedAt: Number.isFinite(+s.updatedAt) ? +s.updatedAt : Date.now(),
  };
  if (Number.isFinite(+s.focusedSeconds)) out.focusedSeconds = +s.focusedSeconds;
  return out;
}

export function sanitizeDeadline(d) {
  if (!d || typeof d !== "object") return null;
  if (typeof d.title !== "string" || typeof d.dueDate !== "string") return null;
  const createdAt = Number.isFinite(+d.createdAt) ? +d.createdAt : Date.now();
  return {
    id: typeof d.id === "string" && d.id ? d.id : newId(),
    title: d.title,
    dueDate: d.dueDate,
    source: typeof d.source === "string" ? d.source : "manual",
    status: normalizeStatus(d),
    createdAt,
    // last-write-wins marker; legacy rows have none, so fall back to createdAt
    updatedAt: Number.isFinite(+d.updatedAt) ? +d.updatedAt : createdAt,
  };
}

// Whitelist what we actually persist so callers can't slip in extra fields.
// name is the catalog key (the worker does not enforce uniqueness — the client
// does). color must be a 6-digit hex so the client can shade it for pastels;
// garbage falls back to a sane default rather than getting rejected.
export function sanitizeSubject(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.name !== "string" || !s.name.trim()) return null;
  const color =
    typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#6366f1";
  const createdAt = Number.isFinite(+s.createdAt) ? +s.createdAt : Date.now();
  return {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    name: s.name.trim(),
    color,
    createdAt,
    // last-write-wins marker, like deadlines
    updatedAt: Number.isFinite(+s.updatedAt) ? +s.updatedAt : createdAt,
  };
}
