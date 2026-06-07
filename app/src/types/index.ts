export type DateKey = string; // 'YYYY-MM-DD'

export interface Session {
  id: string;
  subject: string;
  topic: string;
  time: string; // 'HH:MM'
  duration: number; // minutes
  color: string; // hex
  done: boolean;
  updatedAt: number; // ms epoch
}

export type SessionsByDate = Record<DateKey, Session[]>;

export interface Deadline {
  id: string;
  title: string;
  dueDate: DateKey; // 'YYYY-MM-DD'
  source: 'manual' | string;
  done: boolean;
  createdAt: number; // ms epoch
  completedAt?: number; // ms epoch, set when done toggled true
}

export type SyncState = 'offline' | 'syncing' | 'synced' | 'error';

export interface CloudConfig {
  token: string;
  workerUrl: string;
}
