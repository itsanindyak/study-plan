// Quote route handlers.
// KV key: quote:current  →  { text, updatedAt }
// A single editable line beside the logo, shared across devices. No TTL.
// Per-item last-write-wins on `updatedAt` so a stale device can't silently
// overwrite a newer edit. Empty text is a real value (that's how you clear
// it) and still carries a stamp.

import { quoteKey, sanitizeQuote, json, errResponse } from "./shared.js";

const QUOTE_ID = "current";

// GET /api/quote  →  { quote: { text, updatedAt } | null, updatedAt }
export async function getQuote(env, cors) {
  const item = await env.STUDY_KV.get(quoteKey(QUOTE_ID), { type: "json" });
  console.log(`getQuote: ${item ? "set" : "none"}`);
  return json({ quote: item ?? null, updatedAt: Date.now() }, 200, cors);
}

// PUT /api/quote  body: { text, updatedAt }  →  { ok, item }
// Last-write-wins: an older updatedAt is rejected with
// { ok: false, stale: true, item } so the caller can pick up the winner.
export async function putQuote(body, env, cors) {
  const clean = sanitizeQuote(body);
  if (!clean) {
    console.warn("putQuote: rejected — text must be a string");
    return errResponse(400, "text must be a string", cors);
  }

  const existing = await env.STUDY_KV.get(quoteKey(QUOTE_ID), { type: "json" });
  const existingUpdatedAt = existing ? +existing.updatedAt : NaN;
  if (Number.isFinite(existingUpdatedAt) && existingUpdatedAt > clean.updatedAt) {
    console.log(
      `putQuote: stale write ignored (client=${clean.updatedAt} stored=${existingUpdatedAt})`,
    );
    return json({ ok: false, stale: true, item: existing }, 200, cors);
  }

  await env.STUDY_KV.put(quoteKey(QUOTE_ID), JSON.stringify(clean));
  console.log(`putQuote: ${clean.text.length} chars`);
  return json({ ok: true, item: clean }, 200, cors);
}
