// Shared utilities: CORS, auth, response helpers, KV key/TTL utils, sanitizers.

export const SESSION_PREFIX = "session:";
export const DEADLINE_PREFIX = "deadline:";
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
  const allowOrigin = origin && set.has(origin) ? origin : "";
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
  return allowedOrigins(env).has(origin);
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

// ─── sanitizers ───────────────────────────────────────────────

export function sanitizeSession(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.subject !== "string") return null;
  return {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    time: typeof s.time === "string" ? s.time : "09:00",
    duration: Number.isFinite(+s.duration) && +s.duration > 0 ? +s.duration : 60,
    subject: s.subject,
    topic: typeof s.topic === "string" ? s.topic : "",
    color: typeof s.color === "string" ? s.color : "#6366f1",
    done: !!s.done,
    updatedAt: Number.isFinite(+s.updatedAt) ? +s.updatedAt : Date.now(),
  };
}

export function sanitizeDeadline(d) {
  if (!d || typeof d !== "object") return null;
  if (typeof d.title !== "string" || typeof d.dueDate !== "string") return null;
  return {
    id: typeof d.id === "string" && d.id ? d.id : newId(),
    title: d.title,
    dueDate: d.dueDate,
    source: typeof d.source === "string" ? d.source : "manual",
    done: !!d.done,
    createdAt: Number.isFinite(+d.createdAt) ? +d.createdAt : Date.now(),
  };
}
