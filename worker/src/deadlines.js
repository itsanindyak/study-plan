// Deadline route handlers.
// KV key: deadline:{id}  →  bare deadline object, with KV TTL on the key.

import {
  DEADLINE_PREFIX,
  deadlineKey,
  listAllKeys,
  computeExpiration,
  sanitizeDeadline,
  normalizeRecord,
  json,
  errResponse,
} from "./shared.js";

// GET /api/deadlines  →  { items: [...], updatedAt }
export async function listDeadlines(env, cors) {
  const keys = await listAllKeys(env, DEADLINE_PREFIX);
  const values = await Promise.all(
    keys.map((k) => env.STUDY_KV.get(k.name, { type: "json" }))
  );
  const items = values
    .filter((v) => v != null)
    .map(normalizeRecord)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  console.log(`listDeadlines: ${items.length} of ${keys.length} keys`);
  return json({ items, updatedAt: Date.now() }, 200, cors);
}

// PUT /api/deadlines/:id  body: { id, title, dueDate, source, status, createdAt, updatedAt }  →  { ok, expiresAt }
//
// Last-write-wins per item: a PUT whose updatedAt is older than the stored
// copy is ignored so a stale device can't clobber a newer edit. The stored
// winner is returned with { ok: false, stale: true }.
export async function putDeadline(id, body, env, cors) {
  const clean = sanitizeDeadline({ ...(body || {}), id });
  if (!clean) {
    console.warn(`putDeadline[${id}]: rejected — missing title or dueDate`);
    return errResponse(400, "missing title or dueDate", cors);
  }

  const existing = await env.STUDY_KV.get(deadlineKey(id), { type: "json" });
  const existingUpdatedAt = existing ? +existing.updatedAt : NaN;
  if (Number.isFinite(existingUpdatedAt) && existingUpdatedAt > clean.updatedAt) {
    const expiresAt = computeExpiration(existing.dueDate || clean.dueDate);
    console.log(
      `putDeadline[${id}]: stale write ignored (client=${clean.updatedAt} stored=${existingUpdatedAt})`
    );
    return json({ ok: false, stale: true, item: normalizeRecord(existing), expiresAt }, 200, cors);
  }

  const expiresAt = computeExpiration(clean.dueDate);
  await env.STUDY_KV.put(
    deadlineKey(id),
    JSON.stringify(clean),
    { expiration: expiresAt }
  );
  console.log(`putDeadline[${id}]: title="${clean.title}" dueDate=${clean.dueDate} expiresAt=${expiresAt}`);
  return json({ ok: true, expiresAt }, 200, cors);
}

// DELETE /api/deadlines/:id  →  { ok }
export async function deleteDeadline(id, env, cors) {
  await env.STUDY_KV.delete(deadlineKey(id));
  console.log(`deleteDeadline[${id}]`);
  return json({ ok: true }, 200, cors);
}
