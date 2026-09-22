// Session route handlers.
// KV key: session:YYYY-MM-DD  →  { sessions: [...], rating?, ratingUpdatedAt? }
// The day's 1–10 rating rides inside the same key: rating-only days store an
// empty sessions list, and any PUT bumps the key metadata so incremental
// pulls (`GET /api/all?since=`) pick rating changes up for free.

import {
  SESSION_PREFIX,
  sessionKey,
  sessionTombKey,
  SDEL_TTL_SEC,
  dateFromSessionKey,
  listAllKeys,
  json,
  errResponse,
  normRating,
  sanitizeSession,
  normalizeRecord,
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

  // cacheTtl: 60 — buys read latency (hot reads skip central stores), NOT quota:
  // cached KV reads are still billed. Writes revalidate instantly, so a
  // written key is always fresh; unwritten keys stay up to 60s stale.
  const values = await Promise.all(
    keys.map((k) => env.STUDY_KV.get(k.name, { type: "json", cacheTtl: 60 }))
  );

  const sessions = {};
  let totalSessions = 0;
  keys.forEach((k, i) => {
    const date = dateFromSessionKey(k.name);
    const list = values[i]?.sessions || [];
    sessions[date] = list.map(normalizeRecord);
    totalSessions += list.length;
  });

  console.log(`getAllSessions: ${keys.length} days, ${totalSessions} sessions`);
  return json({ sessions, updatedAt: Date.now() }, 200, cors);
}

// GET /api/sessions/:date  →  { sessions: [...], rating?, ratingUpdatedAt?, updatedAt }  (404 if no data)
export async function getSession(date, env, cors) {
  const raw = await env.STUDY_KV.get(sessionKey(date), { type: "json", cacheTtl: 60 });
  if (!raw) return errResponse(404, "no sessions for that date", cors);
  const sessions = (raw.sessions || []).map(normalizeRecord);
  const out = { sessions, updatedAt: Date.now() };
  const rating = normRating(raw.rating);
  if (rating !== undefined && !Number.isNaN(rating)) {
    out.rating = rating;
    if (Number.isFinite(+raw.ratingUpdatedAt)) out.ratingUpdatedAt = +raw.ratingUpdatedAt;
  }
  return json(out, 200, cors);
}

// PUT /api/sessions/:date  body: { sessions: [...], rating?: 1-10|null, ratingUpdatedAt?: number }
//   →  { ok, updatedAt, sessions, rating?, ratingUpdatedAt? }
// Body is authoritative: the server replaces its state for this date with
// the client's list. Items in server but not in body are removed (handles
// deletes and removes).
//
// Rating semantics: the field is tri-state — ABSENT means "keep whatever the
// server has" (so an old client flushing { sessions } can never wipe a
// rating), `null` explicitly clears, a number 1–10 sets. The client owns
// last-write-wins via ratingUpdatedAt: it re-reads the day before flushing
// and sends the newer of local/remote, same merge as the session list.
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

  // rating: absent → preserve the stored one; null → clear; 1–10 → set.
  // (Reads the existing key only when preserving — set/clear are wholesale.)
  const rating = normRating(body.rating);
  if (Number.isNaN(rating)) {
    console.warn(`putSession[${date}]: rejected — rating must be 1-10 or null`);
    return errResponse(400, "rating must be an integer 1-10 or null", cors);
  }
  let ratingOut;
  let ratingStampOut;
  if (rating === undefined) {
    const existing = await env.STUDY_KV.get(sessionKey(date), { type: "json" });
    const kept = normRating(existing?.rating);
    if (kept !== undefined && !Number.isNaN(kept) && kept !== null) {
      ratingOut = kept;
      if (Number.isFinite(+existing?.ratingUpdatedAt)) ratingStampOut = +existing.ratingUpdatedAt;
    }
  } else if (rating !== null) {
    ratingOut = rating;
    ratingStampOut = Number.isFinite(+body.ratingUpdatedAt) ? +body.ratingUpdatedAt : Date.now();
  }

  const stored = { sessions: sorted };
  if (ratingOut !== undefined) {
    stored.rating = ratingOut;
    if (ratingStampOut !== undefined) stored.ratingUpdatedAt = ratingStampOut;
  }

  // updatedAt rides in key metadata (free with list) so incremental pulls
  // (`GET /api/all?since=`) can detect changed days without reading values
  await env.STUDY_KV.put(
    sessionKey(date),
    JSON.stringify(stored),
    { metadata: { updatedAt: Date.now() } }
  );

  if (dropped > 0) {
    console.warn(`putSession[${date}]: stored ${sorted.length}, dropped ${dropped} invalid items`);
  } else {
    console.log(`putSession[${date}]: stored ${sorted.length} sessions${ratingOut !== undefined ? `, rating ${ratingOut}` : ""}`);
  }

  const out = { ok: true, updatedAt: Date.now(), sessions: sorted };
  if (ratingOut !== undefined) {
    out.rating = ratingOut;
    if (ratingStampOut !== undefined) out.ratingUpdatedAt = ratingStampOut;
  }
  return json(out, 200, cors);
}

// DELETE /api/sessions/:date  →  { ok }
// The day key is removed AND a tombstone is written: incremental pulls list
// the tombstone and report the date in `removedDates` so other devices drop
// it. Tombstones auto-expire after 30d.
export async function deleteSession(date, env, cors) {
  const now = Date.now();
  await env.STUDY_KV.delete(sessionKey(date));
  await env.STUDY_KV.put(sessionTombKey(date), JSON.stringify({ deleted: true, date }), {
    metadata: { updatedAt: now },
    expirationTtl: SDEL_TTL_SEC,
  });
  console.log(`deleteSession[${date}]`);
  return json({ ok: true }, 200, cors);
}
