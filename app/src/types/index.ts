export type DateKey = string; // 'YYYY-MM-DD'

// tri-state task status: 'pending' is the initial state of a new task
export type TaskStatus = 'pending' | 'done' | 'notdone';

export interface Session {
  id: string;
  subject: string;
  topic: string;
  time: string; // 'HH:MM'
  duration: number; // minutes
  color: string; // hex
  status: TaskStatus;
  updatedAt: number; // ms epoch
  focusedSeconds?: number; // actual focus time, set when focus session ends (excludes breaks)
}

export type SessionsByDate = Record<DateKey, Session[]>;

// Day rating (1–10), stored inside the session day key ({ sessions, rating,
// ratingUpdatedAt }) so it rides the day's metadata for incremental pulls.
// value null = cleared locally, not yet flushed. updatedAt drives
// last-write-wins between devices.
export interface RatingEntry {
  value: number | null;
  updatedAt: number; // ms epoch
}

export type RatingsByDate = Record<DateKey, RatingEntry>;

export interface Deadline {
  id: string;
  title: string;
  dueDate: DateKey; // 'YYYY-MM-DD'
  source: 'manual' | string;
  status: TaskStatus;
  createdAt: number; // ms epoch
  completedAt?: number; // ms epoch, set when status becomes 'done'
  updatedAt?: number; // ms epoch, bumped on every edit — used for conflict resolution
}

export interface Subject {
  id: string;
  name: string;
  color: string; // '#RRGGBB'
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch — bumped on every edit; drives last-write-wins
}

export interface Note {
  id: string;
  title: string; // first line of the body, derived at save time
  snippet: string; // rest of the body collapsed to one line, for the list preview
  text?: string; // body — present only for notes this device has opened (or created)
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch — bumped on every save
}

export type SyncState = 'offline' | 'syncing' | 'synced' | 'error';

export interface CloudConfig {
  token: string;
  workerUrl: string;
}
