// Cloudflare Worker KV client. All requests are authorized with a bearer
// token pulled from useSettingsStore. Returns `null` on 404/204 so callers
// can treat "no data" as a normal case.

import type { CloudConfig, DateKey, Deadline, Session, SessionsByDate } from '@/types';

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

  async putSession(cfg: CloudConfig, date: DateKey, sessions: Session[]): Promise<void> {
    await request(cfg, `/api/sessions/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ sessions }),
    });
  },

  async deleteSessionDate(cfg: CloudConfig, date: DateKey): Promise<void> {
    await request(cfg, `/api/sessions/${date}`, { method: 'DELETE' });
  },

  async putDeadline(cfg: CloudConfig, d: Deadline): Promise<void> {
    await request(cfg, `/api/deadlines/${encodeURIComponent(d.id)}`, {
      method: 'PUT',
      body: JSON.stringify(d),
    });
  },

  async deleteDeadline(cfg: CloudConfig, id: string): Promise<void> {
    await request(cfg, `/api/deadlines/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

export { HttpError };
