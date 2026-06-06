// Cloudflare Worker — Study Plan backend.
// Multi-key KV layout:
//   session:YYYY-MM-DD  →  { sessions: [ {id, time, duration, subject, topic, color, done, updatedAt} ] }
//   deadline:{id}       →  { id, title, dueDate, source, done, createdAt }   (with KV TTL)
//
// Auth: Bearer token from env.SECRET_TOKEN.
// CORS: allowlist via env.ALLOWED_ORIGINS (comma-separated; "null" = file://).

import {
  corsHeadersFor,
  originAllowed,
  checkAuth,
  json,
  errResponse,
  MAX_BODY_BYTES,
} from "./shared.js";
import {
  listSessionDates,
  getAllSessions,
  getSession,
  putSession,
  deleteSession,
} from "./sessions.js";
import {
  listDeadlines,
  putDeadline,
  deleteDeadline,
} from "./deadlines.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Real date check — `/^\d{4}-\d{2}-\d{2}$/` alone accepts 2026-13-45.
// We also confirm the parsed date round-trips to the same string so bogus
// months/days like 2026-02-30 are rejected.
function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function readJsonBody(request, cors) {
  // Read as text first so we can enforce the size limit regardless of
  // Content-Length (clients can omit it via chunked transfer encoding).
  let text;
  try {
    text = await request.text();
  } catch {
    return { error: errResponse(400, "Could not read body", cors) };
  }
  if (text.length > MAX_BODY_BYTES) {
    return { error: errResponse(413, "Payload too large", cors) };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: errResponse(400, "Invalid JSON", cors) };
  }
}

// Safe URI-decode that returns null on malformed input instead of throwing.
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

export default {
  async fetch(request, env) {
    const cors = corsHeadersFor(request, env);
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight — no auth needed, but origin must be allowed
    if (request.method === "OPTIONS") {
      if (!originAllowed(request, env)) {
        return new Response(null, { status: 403, headers: cors });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    // All data routes require an allowed origin AND a valid bearer token
    if (!originAllowed(request, env)) {
      return errResponse(403, "Forbidden: origin not allowed", cors);
    }
    if (!checkAuth(request, env)) {
      return errResponse(401, "Unauthorized", cors);
    }

    // ─── routes ───

    if (path === "/api/ping") {
      if (request.method !== "GET") return errResponse(405, "Method not allowed", cors);
      return json({ ok: true, ts: Date.now() }, 200, cors);
    }

    if (path === "/api/sessions") {
      if (request.method !== "GET") return errResponse(405, "Method not allowed", cors);
      return listSessionDates(env, cors);
    }

    if (path === "/api/sessions-all") {
      if (request.method !== "GET") return errResponse(405, "Method not allowed", cors);
      return getAllSessions(env, cors);
    }

    if (path.startsWith("/api/sessions/")) {
      const date = safeDecode(path.slice("/api/sessions/".length));
      if (date === null) return errResponse(400, "bad path encoding", cors);
      if (!isValidDate(date)) return errResponse(400, "bad date (expected YYYY-MM-DD)", cors);

      if (request.method === "GET") return getSession(date, env, cors);
      if (request.method === "PUT") {
        const { body, error } = await readJsonBody(request, cors);
        if (error) return error;
        return putSession(date, body, env, cors);
      }
      if (request.method === "DELETE") return deleteSession(date, env, cors);
      return errResponse(405, "Method not allowed", cors);
    }

    if (path === "/api/deadlines") {
      if (request.method !== "GET") return errResponse(405, "Method not allowed", cors);
      return listDeadlines(env, cors);
    }

    if (path.startsWith("/api/deadlines/")) {
      const id = safeDecode(path.slice("/api/deadlines/".length));
      if (id === null) return errResponse(400, "bad path encoding", cors);
      if (!id) return errResponse(400, "missing id", cors);

      if (request.method === "PUT") {
        const { body, error } = await readJsonBody(request, cors);
        if (error) return error;
        return putDeadline(id, body, env, cors);
      }
      if (request.method === "DELETE") return deleteDeadline(id, env, cors);
      return errResponse(405, "Method not allowed", cors);
    }

    return errResponse(404, "Not found", cors);
  },
};
