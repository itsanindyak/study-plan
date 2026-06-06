// Session route handlers.
// KV key: session:YYYY-MM-DD  →  { sessions: [...] }

import {
  SESSION_PREFIX,
  sessionKey,
  dateFromSessionKey,
  listAllKeys,
  json,
  errResponse,
  sanitizeSession,
} from "./shared.js";

// GET /api/sessions  →  { dates: [YYYY-MM-DD...] }
export async function listSessionDates(env, cors) {
  const keys = await listAllKeys(env, SESSION_PREFIX);
  const dates = keys.map((k) => dateFromSessionKey(k.name)).sort();
  console.log(`listSessionDates: ${dates.length} dates`);
  return json({ dates, listComplete: true }, 200, cors);
}

// GET /api/sessions-all  →  { sessions: {date: [...]}, updatedAt }
export async function getAllSessions(env, cors) {
  const keys = await listAllKeys(env, SESSION_PREFIX);

  // fetch all values in parallel
  const values = await Promise.all(
    keys.map((k) => env.STUDY_KV.get(k.name, { type: "json" }))
  );

  const sessions = {};
  let totalSessions = 0;
  keys.forEach((k, i) => {
    const date = dateFromSessionKey(k.name);
    const list = values[i]?.sessions || [];
    sessions[date] = list;
    totalSessions += list.length;
  });

  console.log(`getAllSessions: ${keys.length} days, ${totalSessions} sessions`);
  return json({ sessions, updatedAt: Date.now() }, 200, cors);
}

// GET /api/sessions/:date  →  { sessions: [...], updatedAt }  (404 if no data)
export async function getSession(date, env, cors) {
  const raw = await env.STUDY_KV.get(sessionKey(date), { type: "json" });
  if (!raw) return errResponse(404, "no sessions for that date", cors);
  return json({ sessions: raw.sessions || [], updatedAt: Date.now() }, 200, cors);
}

// PUT /api/sessions/:date  body: { sessions: [...] }  →  { ok, updatedAt, sessions }
// Body is authoritative: the server replaces its state for this date with
// the client's list. Items in server but not in body are removed (handles
// deletes and removes).
//
// Multi-device safety: clients always bootFromCloud (which pulls remote
// edits into localStorage) before any PUT, so the body reflects the merged
// view. Last write wins per date, which is the right trade-off for a
// personal planner with debounced sync.
export async function putSession(date, body, env, cors) {
  if (!body || !Array.isArray(body.sessions)) {
    console.warn(`putSession[${date}]: rejected — body must be { sessions: [...] }`);
    return errResponse(400, "body must be { sessions: [...] }", cors);
  }
  const incoming = body.sessions.map(sanitizeSession).filter(Boolean);
  const dropped = body.sessions.length - incoming.length;
  if (incoming.length === 0 && body.sessions.length > 0) {
    console.warn(`putSession[${date}]: all ${body.sessions.length} items failed sanitize`);
    return errResponse(400, "no valid sessions in payload", cors);
  }

  const sorted = incoming.slice().sort((a, b) =>
    (a.time || "").localeCompare(b.time || "")
  );

  await env.STUDY_KV.put(
    sessionKey(date),
    JSON.stringify({ sessions: sorted })
  );

  if (dropped > 0) {
    console.warn(`putSession[${date}]: stored ${sorted.length}, dropped ${dropped} invalid items`);
  } else {
    console.log(`putSession[${date}]: stored ${sorted.length} sessions`);
  }

  return json({ ok: true, updatedAt: Date.now(), sessions: sorted }, 200, cors);
}

// DELETE /api/sessions/:date  →  { ok }
export async function deleteSession(date, env, cors) {
  await env.STUDY_KV.delete(sessionKey(date));
  console.log(`deleteSession[${date}]`);
  return json({ ok: true }, 200, cors);
}
