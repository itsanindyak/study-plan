// Cloudflare Worker KV client. All requests are authorized with a bearer
// token pulled from useSettingsStore. Returns `null` on 404/204 so callers
// can treat "no data" as a normal case.

import type {
  CloudConfig,
  DateKey,
  Deadline,
  Note,
  RatingEntry,
  Session,
  SessionsByDate,
  Subject,
} from '@/types';

class HttpError extends Error {
  constructor(public status: number, body: string) {
    super(`${status} ${body}`);
  }
}

async function request<T>(cfg: CloudConfig, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(cfg.workerUrl + path, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new HttpError(res.status, txt);
  }
  return (await res.json()) as T;
}

export const kvClient = {
  async ping(cfg: CloudConfig): Promise<{ ok: boolean; ts: number } | null> {
    return request(cfg, '/api/ping');
  },

  async getAllSessions(cfg: CloudConfig): Promise<SessionsByDate | null> {
    const res = await request<{ sessions: SessionsByDate; updatedAt: number }>(
      cfg,
      '/api/sessions-all',
    );
    return res?.sessions ?? null;
  },

  async getDeadlines(cfg: CloudConfig): Promise<Deadline[] | null> {
    const res = await request<{ items: Deadline[]; updatedAt: number }>(cfg, '/api/deadlines');
    return res?.items ?? null;
  },

  // Day payload: sessions plus the day's 1–10 rating when the server has
  // one. The rating rides inside the session key — zero extra reads.
  async getSession(cfg: CloudConfig, date: DateKey): Promise<{
    sessions: Session[];
    rating?: number;
    ratingUpdatedAt?: number;
  } | null> {
    const res = await request<{
      sessions: Session[];
      rating?: number;
      ratingUpdatedAt?: number;
      updatedAt: number;
    }>(cfg, `/api/sessions/${date}`);
    if (!res) return null;
    return {
      sessions: res.sessions,
      ...(typeof res.rating === 'number' ? { rating: res.rating } : {}),
      ...(typeof res.ratingUpdatedAt === 'number' ? { ratingUpdatedAt: res.ratingUpdatedAt } : {}),
    };
  },

  // rating is tri-state, mirroring the worker: undefined omits the field
  // (server keeps what it has), null clears, a value sets. Pass undefined
  // unless the caller resolved the local/remote winner first.
  async putSession(
    cfg: CloudConfig,
    date: DateKey,
    sessions: Session[],
    rating?: RatingEntry | undefined,
  ): Promise<void> {
    await request(cfg, `/api/sessions/${date}`, {
      method: 'PUT',
      body: JSON.stringify({
        sessions,
        ...(rating !== undefined
          ? { rating: rating.value, ratingUpdatedAt: rating.updatedAt }
          : {}),
      }),
    });
  },

  async deleteSessionDate(cfg: CloudConfig, date: DateKey): Promise<void> {
    await request(cfg, `/api/sessions/${date}`, { method: 'DELETE' });
  },

  // The worker applies last-write-wins per item; a stale PUT returns
  // { ok: false, stale: true } with the stored winner instead of overwriting.
  async putDeadline(
    cfg: CloudConfig,
    d: Deadline,
  ): Promise<{ ok: boolean; stale?: boolean } | null> {
    return request<{ ok: boolean; stale?: boolean }>(cfg, `/api/deadlines/${encodeURIComponent(d.id)}`, {
      method: 'PUT',
      body: JSON.stringify(d),
    });
  },

  async deleteDeadline(cfg: CloudConfig, id: string): Promise<void> {
    await request(cfg, `/api/deadlines/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getSubjects(cfg: CloudConfig): Promise<Subject[] | null> {
    const res = await request<{ items: Subject[]; updatedAt: number }>(cfg, '/api/subjects');
    return res?.items ?? null;
  },

  // LWW on updatedAt; older write returns { ok:false, stale:true, item }.
  async putSubject(
    cfg: CloudConfig,
    s: Subject,
  ): Promise<{ ok: boolean; stale?: boolean } | null> {
    return request<{ ok: boolean; stale?: boolean }>(
      cfg,
      `/api/subjects/${encodeURIComponent(s.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(s),
      },
    );
  },

  async deleteSubject(cfg: CloudConfig, id: string): Promise<void> {
    await request(cfg, `/api/subjects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getNotes(cfg: CloudConfig): Promise<Note[] | null> {
    const res = await request<{ items: Note[]; updatedAt: number }>(cfg, '/api/notes');
    return res?.items ?? null;
  },

  // One note's body — opening a note costs a single read. Returns null on 404
  // (deleted elsewhere or never synced).
  async getNote(cfg: CloudConfig, id: string, init?: RequestInit): Promise<Note | null> {
    const res = await request<{ note: Note; updatedAt: number }>(
      cfg,
      `/api/notes/${encodeURIComponent(id)}`,
      init ?? {},
    );
    return res?.note ?? null;
  },

  // LWW on updatedAt; older write returns { ok:false, stale:true, item }.
  async putNote(
    cfg: CloudConfig,
    n: Note,
  ): Promise<{ ok: boolean; stale?: boolean; item?: Note } | null> {
    return request<{ ok: boolean; stale?: boolean; item?: Note }>(
      cfg,
      `/api/notes/${encodeURIComponent(n.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(n),
      },
    );
  },

  async deleteNote(cfg: CloudConfig, id: string): Promise<void> {
    await request(cfg, `/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // Whole-plan snapshot in one request (single namespace list server-side).
  // Returns null on 404 — an older worker without /api/all — and the caller
  // falls back to the four per-collection requests.
  // With `since` (the client's last watermark) the server value-reads only
  // days changed after it and reports deleted days in `removedDates` (absent
  // entirely on a legacy worker — the caller's cue to do a full merge).
  // `ratings` rides inside the day values at zero extra cost; in incremental
  // mode it covers only changed days (upsert semantics, like sessions). A
  // legacy worker omits it entirely — the caller must not touch local ratings.
  async getAll(
    cfg: CloudConfig,
    since?: number | null,
  ): Promise<{
    sessions: SessionsByDate;
    ratings?: Record<DateKey, { value: number; updatedAt: number }>;
    deadlines: Deadline[];
    subjects: Subject[];
    notes: Note[];
    removedDates?: string[];
    updatedAt: number;
  } | null> {
    const path = since != null && Number.isFinite(since) ? `/api/all?since=${since}` : '/api/all';
    return request<{
      sessions: SessionsByDate;
      ratings?: Record<DateKey, { value: number; updatedAt: number }>;
      deadlines: Deadline[];
      subjects: Subject[];
      notes: Note[];
      removedDates?: string[];
      updatedAt: number;
    }>(cfg, path);
  },
};

export { HttpError };
