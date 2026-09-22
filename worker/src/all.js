// Single-pull snapshot. One namespace-wide `list` (the tightest KV quota is
// 1,000 list requests/day, so four per pull adds up), keys bucketed by prefix,
// then one parallel get per value key. The notes section comes straight from
// key metadata — no note values are read here.
//
// Incremental mode (`since` = the client's last watermark): session values are
// read only for days whose key metadata updatedAt postdates `since`
// (metadata-less legacy keys are always read until backfilled), and deleted
// days are reported via tombstones. The watermark returned is captured BEFORE
// the list, so a write landing mid-pull is caught by the next pull — no gap.
//
// Response: { sessions, deadlines, subjects, notes, removedDates, updatedAt }
//   sessions  → { "YYYY-MM-DD": [ session, ... ] }   (changed days only when since)
//   deadlines → [ deadline, ... ]        (legacy done:boolean normalized)
//   subjects  → [ subject, ... ]
//   notes     → [ {id,title,snippet,createdAt,updatedAt}, ... ]   (newest first)
//   removedDates → [ "YYYY-MM-DD", ... ] (deleted days changed since `since`)

import {
  SESSION_PREFIX,
  DEADLINE_PREFIX,
  SUBJECT_PREFIX,
  NOTE_PREFIX,
  SDEL_PREFIX,
  listAllKeys,
  normalizeRecord,
  sanitizeSubject,
  sanitizeNote,
  dateFromSessionTombKey,
  json,
} from "./shared.js";
import { noteMetaFromKey } from "./notes.js";

const idFrom = (name, prefix) => name.slice(prefix.length);

export async function getAll(env, cors, since) {
  // t0 is captured BEFORE the list: any write after t0 has updatedAt > t0, so
  // the client's next pull (watermarked at t0) catches it — no gap between
  // the watermark it stores and the data it received.
  const t0 = Date.now();
  const incremental = Number.isFinite(since);
  const keys = await listAllKeys(env);

  const sessionNames = [];
  const deadlineNames = [];
  const subjectNames = [];
  const removedDates = [];
  let noteRows = [];

  for (const k of keys) {
    const name = k.name;
    if (name.startsWith(SESSION_PREFIX)) {
      // incremental: value-read only days changed since the client's watermark.
      // keys without metadata are legacy (pre-metadata writes) — always include
      // until the backfill/healing pass gives them metadata.
      const updatedAt = Number(k.metadata?.updatedAt);
      if (!incremental || !Number.isFinite(updatedAt) || updatedAt > since) {
        sessionNames.push(name);
      }
    }
    else if (name.startsWith(DEADLINE_PREFIX)) deadlineNames.push(name);
    else if (name.startsWith(SUBJECT_PREFIX)) subjectNames.push(name);
    else if (name.startsWith(NOTE_PREFIX)) noteRows.push(noteMetaFromKey(k));
    else if (name.startsWith(SDEL_PREFIX)) {
      // deleted-day tombstone: report it only when it postdates the watermark
      const updatedAt = Number(k.metadata?.updatedAt);
      if (!incremental || (Number.isFinite(updatedAt) && updatedAt > since)) {
        removedDates.push(dateFromSessionTombKey(name));
      }
    }
    // anything else (stray keys) is ignored — never served
  }

  // sessions read with cacheTtl: 60 — KV cache hits are still billed as reads
  // (per Cloudflare's pricing docs), so this buys LATENCY (hot reads skip the
  // central stores, typically much faster than a cold read), not quota. Writes
  // revalidate instantly, so a written key is always fresh to other browsers;
  // only keys nobody wrote in 60s stay up to 60s stale.
  // notes/deadlines/subjects stay uncached — each is a single read.
  const [sessionVals, deadlineVals, subjectVals] = await Promise.all([
    Promise.all(sessionNames.map((n) => env.STUDY_KV.get(n, { type: "json", cacheTtl: 60 }))),
    Promise.all(deadlineNames.map((n) => env.STUDY_KV.get(n, { type: "json" }))),
    Promise.all(subjectNames.map((n) => env.STUDY_KV.get(n, { type: "json" }))),
  ]);

  const sessions = {};
  let totalSessions = 0;
  sessionNames.forEach((name, i) => {
    const date = idFrom(name, SESSION_PREFIX);
    const list = (sessionVals[i] && sessionVals[i].sessions) || [];
    sessions[date] = list.map(normalizeRecord);
    totalSessions += sessions[date].length;
  });

  const deadlines = deadlineVals
    .filter((v) => v != null)
    .map(normalizeRecord)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const subjects = subjectVals
    .filter((v) => v != null)
    .map(sanitizeSubject)
    .filter(Boolean)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // metadata-less (legacy) note rows: value-read just those few keys — no
  // second list, the whole point of this endpoint is the single scan
  const legacyRows = noteRows.filter((r) => r.title === null || r.updatedAt === null);
  if (legacyRows.length) {
    const legacyVals = await Promise.all(
      legacyRows.map((r) => env.STUDY_KV.get(NOTE_PREFIX + r.id, { type: "json" })),
    );
    legacyVals.forEach((v, i) => {
      const clean = sanitizeNote(v);
      if (!clean) return;
      const row = legacyRows[i];
      row.title = clean.title;
      row.snippet = clean.snippet;
      row.createdAt = clean.createdAt;
      row.updatedAt = clean.updatedAt;
    });
  }
  const notes = noteRows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  console.log(
    `getAll: ${sessionNames.length} days/${totalSessions} sessions, ` +
      `${deadlines.length} deadlines, ${subjects.length} subjects, ${notes.length} notes` +
      (incremental ? `, removed ${removedDates.length} days (since=${since})` : ` (full)`),
  );
  return json(
    { sessions, deadlines, subjects, notes, removedDates, updatedAt: t0 },
    200,
    cors,
  );
}
