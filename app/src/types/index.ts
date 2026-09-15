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

export interface Deadline {
  id: string;
  title: string;
  dueDate: DateKey; // 'YYYY-MM-DD'
  source: 'manual' | string;
  status: TaskStatus;
  createdAt: number; // ms epoch
  completedAt?: number; // ms epoch, set when status becomes 'done'
}

export type SyncState = 'offline' | 'syncing' | 'synced' | 'error';

export interface CloudConfig {
  token: string;
  workerUrl: string;
}
