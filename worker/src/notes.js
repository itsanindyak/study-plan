// Note route handlers.
// KV key: note:{id}  →  { id, title, snippet, text, createdAt, updatedAt }
// KV metadata: { title, snippet, createdAt, updatedAt } — the list returns
// these straight from the key scan without reading any values, so browsing
// the notes costs one list operation no matter how many notes exist.
//
// No TTL — a note lives until it's deleted. Per-item last-write-wins on
// `updatedAt` so a stale device can't clobber newer text.

import {
  NOTE_PREFIX,
  noteKey,
  listAllKeys,
  sanitizeNote,
  deriveNoteTitle,
  deriveNoteSnippet,
  json,
  errResponse,
} from "./shared.js";

// Build a metadata row from a listed key. Rows written before metadata existed
// have no metadata; the caller value-reads those few keys as a fallback (they
// gain metadata the next time they're saved).
export function noteMetaFromKey(k) {
  const m = (k && k.metadata) || {};
  return {
    id: k.name.slice(NOTE_PREFIX.length),
    title: typeof m.title === "string" ? m.title : null,
    snippet: typeof m.snippet === "string" ? m.snippet : null,
    createdAt: Number.isFinite(+m.createdAt) ? +m.createdAt : null,
    updatedAt: Number.isFinite(+m.updatedAt) ? +m.updatedAt : null,
  };
}

// Shared by GET /api/notes and GET /api/all: one list, values only for legacy
// rows whose metadata is missing.
export async function listNoteMeta(env) {
  const keys = await listAllKeys(env, NOTE_PREFIX);
  const rows = keys.map(noteMetaFromKey);
  const legacy = rows.filter((r) => r.title === null || r.updatedAt === null);
  if (legacy.length) {
    const values = await Promise.all(
      legacy.map((r) => env.STUDY_KV.get(noteKey(r.id), { type: "json" })),
    );
    values.forEach((v, i) => {
      const row = legacy[i];
      const clean = sanitizeNote(v);
      if (!clean) return;
      row.title = clean.title;
      row.snippet = clean.snippet;
      row.createdAt = clean.createdAt;
      row.updatedAt = clean.updatedAt;
    });
  }
  // most recently updated first — what the notes list renders
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// GET /api/notes  →  { items: [{id,title,snippet,createdAt,updatedAt}], updatedAt }
export async function listNotes(env, cors) {
  const items = await listNoteMeta(env);
  console.log(`listNotes: ${items.length} notes`);
  return json({ items, updatedAt: Date.now() }, 200, cors);
}

// GET /api/notes/:id  →  { note: { id, title, snippet, text, ... }, updatedAt }
// Opening one note costs a single read.
export async function getNote(id, env, cors) {
  const raw = await env.STUDY_KV.get(noteKey(id), { type: "json" });
  if (!raw) return errResponse(404, "no such note", cors);
  const clean = sanitizeNote({ ...(raw || {}), id });
  console.log(`getNote[${id}]: ${clean.text.length} chars`);
  return json({ note: clean, updatedAt: Date.now() }, 200, cors);
}

// PUT /api/notes/:id  body: { id, title, snippet, text, createdAt, updatedAt }
// Last-write-wins per item: an older updatedAt is rejected with
// { ok: false, stale: true, item } so the caller can adopt the winner.
// The title/snippet ride along as KV metadata so lists never read values.
export async function putNote(id, body, env, cors) {
  const clean = sanitizeNote({ ...(body || {}), id });
  if (!clean) {
    console.warn(`putNote[${id}]: rejected — text must be a string`);
    return errResponse(400, "text must be a string", cors);
  }

  const existing = await env.STUDY_KV.get(noteKey(id), { type: "json" });
  const existingUpdatedAt = existing ? +existing.updatedAt : NaN;
  if (Number.isFinite(existingUpdatedAt) && existingUpdatedAt > clean.updatedAt) {
    console.log(
      `putNote[${id}]: stale write ignored (client=${clean.updatedAt} stored=${existingUpdatedAt})`,
    );
    return json({ ok: false, stale: true, item: sanitizeNote({ ...(existing || {}), id }) }, 200, cors);
  }

  await env.STUDY_KV.put(noteKey(id), JSON.stringify(clean), {
    metadata: {
      title: clean.title,
      snippet: clean.snippet,
      createdAt: clean.createdAt,
      updatedAt: clean.updatedAt,
    },
  });
  console.log(`putNote[${id}]: ${clean.text.length} chars, title="${clean.title}"`);
  return json({ ok: true }, 200, cors);
}

// DELETE /api/notes/:id  →  { ok }
export async function deleteNote(id, env, cors) {
  await env.STUDY_KV.delete(noteKey(id));
  console.log(`deleteNote[${id}]`);
  return json({ ok: true }, 200, cors);
}
