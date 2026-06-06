// Deadline route handlers.
// KV key: deadline:{id}  →  bare deadline object, with KV TTL on the key.

import {
  DEADLINE_PREFIX,
  deadlineKey,
  listAllKeys,
  computeExpiration,
  sanitizeDeadline,
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
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  console.log(`listDeadlines: ${items.length} of ${keys.length} keys`);
  return json({ items, updatedAt: Date.now() }, 200, cors);
}

// PUT /api/deadlines/:id  body: { id, title, dueDate, source, done, createdAt }  →  { ok, expiresAt }
export async function putDeadline(id, body, env, cors) {
  const clean = sanitizeDeadline({ ...(body || {}), id });
  if (!clean) {
    console.warn(`putDeadline[${id}]: rejected — missing title or dueDate`);
    return errResponse(400, "missing title or dueDate", cors);
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
