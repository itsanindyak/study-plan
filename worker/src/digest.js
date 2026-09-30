// Daily deadline digest email.
//
// KV keys (own namespace, no collision with data keys):
//   digest:config   →  { time: "07:00", enabled: true, tzOffsetMinutes: 330, updatedAt }
//   digest:lastSent →  "YYYY-MM-DD"  (dedupe marker, overwritten each send)
//
// Flow: cron tick → runDigest(env)
//   gates: enabled → hour reached in configured tz → not already sent today
//   gather: pending deadlines + today's sessions (direct KV reads)
//   build:  HTML (tables + inline CSS — clients strip <style>) + plain text
//   send:   POST JSON-RPC tools/call "send_email" to env.AGENT_MCP_URL
//           Authorization: Bearer <env.AGENT_MCP_TOKEN>
//   on success → write digest:lastSent = local date
//
// The /mcp route may be stateless (direct tools/call) or stateful (Streamable
// HTTP with initialize → Mcp-Session-Id). callSendEmail tries stateless first
// and falls back to the handshake, so either deployment works.

import { fetchDeadlines } from "./deadlines.js";
import { sessionKey, normalizeRecord, json, errResponse } from "./shared.js";

const CONFIG_KEY = "digest:config";
const LAST_SENT_KEY = "digest:lastSent";

const DEFAULT_CONFIG = { time: "07:00", enabled: true, tzOffsetMinutes: 330 };

const MAX_SUBJECT = 200;
const MAX_TEXT = 10000;
const MAX_HTML = 50000;
const MAX_DEADLINE_ROWS = 40;
const MAX_SESSION_ROWS = 25;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── config ───────────────────────────────────────────────────

async function loadConfig(env) {
  const stored = await env.STUDY_KV.get(CONFIG_KEY, { type: "json" });
  return { ...DEFAULT_CONFIG, ...(stored || {}) };
}

// Accepts partial bodies from the settings popup. Returns the cleaned delta,
// or null when any provided field is invalid. `time` is whole hours ("HH:00").
export function sanitizeDigestConfig(body) {
  if (!body || typeof body !== "object") return null;
  const out = {};
  if (body.time !== undefined) {
    const m = String(body.time).match(/^(\d{1,2}):00$/);
    const h = m ? Number(m[1]) : NaN;
    if (!Number.isInteger(h) || h < 0 || h > 23) return null;
    out.time = String(h).padStart(2, "0") + ":00";
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return null;
    out.enabled = body.enabled;
  }
  if (body.tzOffsetMinutes !== undefined) {
    const n = Number(body.tzOffsetMinutes);
    if (!Number.isInteger(n) || n < -840 || n > 840) return null;
    out.tzOffsetMinutes = n;
  }
  return out;
}

export async function getDigestConfig(env, cors) {
  const cfg = await loadConfig(env);
  return json(cfg, 200, cors);
}

export async function putDigestConfig(body, env, cors) {
  const clean = sanitizeDigestConfig(body);
  if (!clean) return errResponse(400, "bad digest config", cors);
  const merged = { ...(await loadConfig(env)), ...clean, updatedAt: Date.now() };
  await env.STUDY_KV.put(CONFIG_KEY, JSON.stringify(merged));
  console.log(`putDigestConfig: time=${merged.time} enabled=${merged.enabled} tz=${merged.tzOffsetMinutes}`);
  return json({ ok: true, config: merged }, 200, cors);
}

// ─── time helpers ─────────────────────────────────────────────

// Local wall-clock in a fixed UTC offset (minutes east of UTC).
function localDateHour(ms, tzOffsetMinutes) {
  const d = new Date(ms + tzOffsetMinutes * 60000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

function daysBetween(dueDate, todayDate) {
  return Math.round((Date.parse(dueDate + "T00:00:00Z") - Date.parse(todayDate + "T00:00:00Z")) / 86400000);
}

function urgencyOf(dueDate, todayDate) {
  const days = daysBetween(dueDate, todayDate);
  if (days < 0) return { days, level: "overdue", label: days === -1 ? "1 day overdue" : `${-days} days overdue` };
  if (days === 0) return { days, level: "today", label: "due today" };
  if (days === 1) return { days, level: "soon", label: "tomorrow" };
  return { days, level: days <= 3 ? "soon" : "later", label: `in ${days} days` };
}

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const HTML_ESC = { "&": "\u0026amp;", "<": "\u0026lt;", ">": "\u0026gt;", '"': "\u0026quot;" };
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => HTML_ESC[c]);
}

const LEVEL_COLOR = { overdue: "#dc2626", today: "#ea580c", soon: "#d97706", later: "#16a34a" };

// ─── payload assembly ─────────────────────────────────────────

async function buildPayload(env, todayDate) {
  const pending = (await fetchDeadlines(env)).filter((d) => d.status === "pending");
  const day = await env.STUDY_KV.get(sessionKey(todayDate), { type: "json" });
  const sessions = ((day && day.sessions) || [])
    .map(normalizeRecord)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  const rows = pending.slice(0, MAX_DEADLINE_ROWS).map((d) => ({
    title: d.title,
    dueDate: d.dueDate,
    ...urgencyOf(d.dueDate, todayDate),
  }));
  const overdue = rows.filter((r) => r.level === "overdue").length;
  const soon = rows.filter((r) => r.level === "today" || r.level === "soon").length;
  const later = rows.length - overdue - soon;

  const subject = buildSubject(todayDate, { overdue, soon, later, sessions: sessions.length, pending: rows.length });
  return {
    subject,
    text: buildText(todayDate, rows, sessions, pending.length),
    html: buildHtml(todayDate, rows, sessions, pending.length, sessions.length),
    stats: { overdue, soon, later, pending: pending.length, sessions: sessions.length },
  };
}

function buildSubject(todayDate, counts) {
  const parts = [];
  if (counts.overdue) parts.push(`${counts.overdue} overdue`);
  if (counts.soon) parts.push(`${counts.soon} due soon`);
  if (counts.later) parts.push(`${counts.later} ahead`);
  if (!counts.pending) parts.push("no deadlines");
  if (counts.sessions) parts.push(`${counts.sessions} session${counts.sessions === 1 ? "" : "s"} today`);
  return `Study Plan — ${fmtDateLong(todayDate)} · ${parts.join(" · ")}`.slice(0, MAX_SUBJECT);
}

function buildText(todayDate, rows, sessions, totalPending) {
  const lines = [`Study Plan — ${fmtDateLong(todayDate)}`, ""];

  lines.push("DEADLINES");
  if (!rows.length) {
    lines.push("  No pending deadlines — all clear.");
  } else {
    for (const r of rows) {
      const mark = r.level === "overdue" ? "!" : r.level === "later" ? "·" : "*";
      lines.push(`  ${mark} ${r.title} — ${r.label} (${r.dueDate})`);
    }
    if (totalPending > rows.length) lines.push(`  …and ${totalPending - rows.length} more`);
  }
  lines.push("");

  lines.push("TODAY'S SESSIONS");
  if (!sessions.length) {
    lines.push("  Nothing scheduled.");
  } else {
    for (const s of sessions.slice(0, MAX_SESSION_ROWS)) {
      const status = s.status === "done" ? " [done]" : s.status === "notdone" ? " [not done]" : "";
      lines.push(`  ${s.time || "--:--"}  ${s.subject}${s.topic ? " — " + s.topic : ""} (${s.duration || 0} min)${status}`);
    }
    if (sessions.length > MAX_SESSION_ROWS) lines.push(`  …and ${sessions.length - MAX_SESSION_ROWS} more`);
  }
  lines.push("", "— sent automatically by your Study Plan worker");

  let text = lines.join("\n");
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 20) + "\n… [truncated]";
  return text;
}

function buildHtml(todayDate, rows, sessions, totalPending, totalSessions) {
  const headerStats = rows.length
    ? `${rows.filter((r) => r.level === "overdue").length} overdue · ${rows.filter((r) => r.level === "today" || r.level === "soon").length} due soon · ${sessions.length} session${sessions.length === 1 ? "" : "s"} today`
    : sessions.length
      ? `No deadlines · ${sessions.length} session${sessions.length === 1 ? "" : "s"} today`
      : "No deadlines · nothing scheduled — enjoy the breathing room";

  let dl = "";
  if (!rows.length) {
    dl = `<tr><td style="padding:0 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid #16a34a;background:#f0fdf4;border-radius:0 8px 8px 0;">
        <tr><td style="padding:14px 16px;font-size:15px;color:#15803d;font-weight:600;">No pending deadlines — all clear.</td></tr>
      </table></td></tr>`;
  } else {
    for (const r of rows) {
      const color = LEVEL_COLOR[r.level] || LEVEL_COLOR.later;
      const bg = r.level === "overdue" ? "#fef2f2" : r.level === "today" ? "#fff7ed" : "#fafafa";
      dl += `<tr><td style="padding:0 32px 10px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid ${color};background:${bg};border-radius:0 8px 8px 0;">
        <tr><td style="padding:12px 16px;">
          <div style="font-size:15px;font-weight:600;color:#111827;line-height:1.3;">${esc(r.title)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:3px;">${esc(r.dueDate)}  ·  <span style="color:${color};font-weight:600;">${esc(r.label)}</span></div>
        </td></tr>
      </table></td></tr>`;
    }
    if (totalPending > rows.length) {
      dl += `<tr><td style="padding:0 32px 16px;font-size:13px;color:#9ca3af;">…and ${totalPending - rows.length} more deadlines</td></tr>`;
    }
  }

  let ss = "";
  if (!sessions.length) {
    ss = `<tr><td style="padding:14px 16px;font-size:14px;color:#6b7280;background:#f9fafb;border-radius:8px;">Nothing scheduled today.</td></tr>`;
  } else {
    let i = 0;
    for (const s of sessions.slice(0, MAX_SESSION_ROWS)) {
      const color = /^#[0-9a-fA-F]{6}$/.test(s.color || "") ? s.color : "#6366f1";
      const done = s.status === "done";
      const notdone = s.status === "notdone";
      const titleColor = done ? "#9ca3af" : notdone ? "#b0b3bd" : "#111827";
      const titleDeco = notdone ? "text-decoration:line-through;" : done ? "opacity:.65;" : "";
      const statusChip = done
        ? `<span style="font-size:11px;color:#16a34a;font-weight:600;">DONE</span>`
        : notdone
          ? `<span style="font-size:11px;color:#9ca3af;font-weight:600;">SKIPPED</span>`
          : "";
      ss += `<tr${i % 2 ? ' style="background:#f9fafb;"' : ""}>
        <td style="padding:10px 16px;font-size:13px;color:#6b7280;font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(s.time || "--:--")}</td>
        <td style="padding:10px 0;width:10px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span></td>
        <td style="padding:10px 16px 10px 4px;${titleDeco}">
          <div style="font-size:14px;font-weight:600;color:${titleColor};">${esc(s.subject)} ${statusChip}</div>
          ${s.topic ? `<div style="font-size:12px;color:#6b7280;margin-top:1px;${titleDeco}">${esc(s.topic)}</div>` : ""}
        </td>
        <td style="padding:10px 16px;font-size:12px;color:#6b7280;white-space:nowrap;text-align:right;">${Number(s.duration) || 0} min</td>
      </tr>`;
      i++;
    }
    if (sessions.length > MAX_SESSION_ROWS) {
      ss += `<tr><td colspan="4" style="padding:8px 16px;font-size:13px;color:#9ca3af;">…and ${sessions.length - MAX_SESSION_ROWS} more</td></tr>`;
    }
  }

  return `<div style="background-color:#f4f5f7;padding:24px 12px;margin:0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
    <tr><td style="background:#16182d;padding:28px 32px;border-radius:12px 12px 0 0;">
      <div style="font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#8b93ff;font-weight:700;">Study Plan</div>
      <div style="font-size:24px;color:#ffffff;font-weight:700;margin-top:8px;line-height:1.2;">${esc(fmtDateLong(todayDate))}</div>
      <div style="font-size:13px;color:#a7abd4;margin-top:6px;">${esc(headerStats)}</div>
    </td></tr>
    <tr><td style="padding:24px 32px 10px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;">Deadlines</div>
    </td></tr>
    ${dl}
    <tr><td style="padding:14px 32px 10px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;">Today’s sessions</div>
    </td></tr>
    <tr><td style="padding:0 32px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;">${ss}</table>
    </td></tr>
    <tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
      Sent automatically by your Study Plan worker · edit the send time from the deadline card
    </td></tr>
  </table>
</div>`.slice(0, MAX_HTML);
}

// ─── MCP transport ────────────────────────────────────────────

async function mcpPost(url, token, body, sessionId) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

// Servers may answer with plain JSON or with SSE frames (`data: {...}` lines).
async function parseMcp(res) {
  const raw = await res.text();
  try {
    return { data: JSON.parse(raw), raw };
  } catch {}
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t.startsWith("data:")) {
      try {
        return { data: JSON.parse(t.slice(5).trim()), raw };
      } catch {}
    }
  }
  return { data: null, raw };
}

async function callSendEmail(env, { to, subject, body, html }) {
  const url = env.AGENT_MCP_URL;
  const token = env.AGENT_MCP_TOKEN;
  if (!url) throw new Error("AGENT_MCP_URL not set");
  if (!token) throw new Error("AGENT_MCP_TOKEN not set");
  if (!to) throw new Error("MAIL_TO not set");

  const args = { to, subject, body };
  if (html) args.html = html;
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "send_email", arguments: args } };

  // Try stateless first — a direct tools/call.
  let res = await mcpPost(url, token, call, null);
  let parsed = await parseMcp(res);
  if (res.ok && parsed.data && !parsed.data.error && parsed.data.result) return parsed.data;
  const callDiag = `tools/call: ${res.status} ${String(parsed.raw).slice(0, 120)}`;

  // Stateful Streamable HTTP: initialize → initialized → tools/call.
  console.log(`callSendEmail: direct call failed (${res.status}), trying initialize handshake`);
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "study-plan-digest", version: "1.0.0" },
    },
  };
  const initRes = await mcpPost(url, token, init, null);
  const initParsed = await parseMcp(initRes);
  const sessionId = initRes.headers.get("Mcp-Session-Id");
  if (!initRes.ok || !initParsed.data || initParsed.data.error) {
    throw new Error(`MCP initialize failed [${url}]: ${initRes.status} ${initParsed.raw.slice(0, 200)} (after ${callDiag})`);
  }
  await mcpPost(url, token, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);

  res = await mcpPost(url, token, call, sessionId);
  parsed = await parseMcp(res);
  if (!res.ok || !parsed.data || parsed.data.error) {
    throw new Error(`MCP tools/call failed [${url}]: ${res.status} ${parsed.raw.slice(0, 200)}`);
  }
  return parsed.data;
}

// ─── send pipeline ───────────────────────────────────────────

async function sendDigest(env, todayDate) {
  const payload = await buildPayload(env, todayDate);
  const result = await callSendEmail(env, {
    to: env.MAIL_TO,
    subject: payload.subject,
    body: payload.text,
    html: payload.html,
  });
  await env.STUDY_KV.put(LAST_SENT_KEY, todayDate);
  console.log(`sendDigest[${todayDate}]: sent — ${payload.subject}`);
  return { result, stats: payload.stats, subject: payload.subject };
}

// Cron entry point. Never throws — errors are logged so one bad tick
// doesn't take down the invocation; the next tick self-heals via the
// localHour >= configHour gate plus the per-day lastSent marker.
export async function runDigest(env) {
  try {
    const cfg = await loadConfig(env);
    if (!cfg.enabled) return;
    const local = localDateHour(Date.now(), cfg.tzOffsetMinutes);
    const configHour = Number(String(cfg.time).slice(0, 2));
    if (local.hour < configHour) return;
    const lastSent = await env.STUDY_KV.get(LAST_SENT_KEY);
    if (lastSent === local.date) return;
    await sendDigest(env, local.date);
  } catch (e) {
    console.error("runDigest failed:", e && e.message ? e.message : e);
  }
}

// Manual "send now" from the settings popup — skips every gate.
export async function sendTestDigest(env, cors) {
  try {
    const local = localDateHour(Date.now(), (await loadConfig(env)).tzOffsetMinutes);
    const sent = await sendDigest(env, local.date);
    return json({ ok: true, subject: sent.subject, stats: sent.stats }, 200, cors);
  } catch (e) {
    console.error("sendTestDigest failed:", e && e.message ? e.message : e);
    return errResponse(502, `send failed: ${e && e.message ? e.message : e}`, cors);
  }
}

// Renders the email as raw HTML in the browser — iterate on the design
// without sending anything.
export async function previewDigest(env, cors) {
  const local = localDateHour(Date.now(), (await loadConfig(env)).tzOffsetMinutes);
  const payload = await buildPayload(env, local.date);
  return new Response(payload.html, {
    headers: { ...(cors || {}), "Content-Type": "text/html; charset=utf-8" },
  });
}
