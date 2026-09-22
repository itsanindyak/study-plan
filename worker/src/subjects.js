// Subject route handlers.
// KV key: subject:{id}  →  { id, name, color, createdAt, updatedAt }
// No TTL — subjects are a long-lived catalog. Per-item last-write-wins on
// `updatedAt` so a stale device can't silently overwrite a recolor or rename.

import {
  SUBJECT_PREFIX,
  subjectKey,
  listAllKeys,
  sanitizeSubject,
  json,
  errResponse,
} from "./shared.js";

// GET /api/subjects  →  { items: [...], updatedAt }
export async function listSubjects(env, cors) {
  const keys = await listAllKeys(env, SUBJECT_PREFIX);
  const values = await Promise.all(
    keys.map((k) => env.STUDY_KV.get(k.name, { type: "json" })),
  );
  // subjects have no tri-state status, so no normalizeRecord here — it would
  // inject a meaningless `status: "pending"` into the catalog.
  const items = values
    .filter((v) => v != null)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  console.log(`listSubjects: ${items.length} of ${keys.length} keys`);
  return json({ items, updatedAt: Date.now() }, 200, cors);
}

// PUT /api/subjects/:id  body: { id, name, color, createdAt, updatedAt }
// Last-write-wins per item: an older updatedAt is rejected with
// { ok: false, stale: true, item } so the caller can pick up the winner.
export async function putSubject(id, body, env, cors) {
  const clean = sanitizeSubject({ ...(body || {}), id });
  if (!clean) {
    console.warn(`putSubject[${id}]: rejected — missing name`);
    return errResponse(400, "missing name", cors);
  }

  const existing = await env.STUDY_KV.get(subjectKey(id), { type: "json" });
  const existingUpdatedAt = existing ? +existing.updatedAt : NaN;
  if (Number.isFinite(existingUpdatedAt) && existingUpdatedAt > clean.updatedAt) {
    console.log(
      `putSubject[${id}]: stale write ignored (client=${clean.updatedAt} stored=${existingUpdatedAt})`,
    );
    return json({ ok: false, stale: true, item: existing }, 200, cors);
  }

  await env.STUDY_KV.put(subjectKey(id), JSON.stringify(clean));
  console.log(`putSubject[${id}]: name="${clean.name}" color=${clean.color}`);
  return json({ ok: true }, 200, cors);
}

// DELETE /api/subjects/:id  →  { ok }
export async function deleteSubject(id, env, cors) {
  await env.STUDY_KV.delete(subjectKey(id));
  console.log(`deleteSubject[${id}]`);
  return json({ ok: true }, 200, cors);
}
