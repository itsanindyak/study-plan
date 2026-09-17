/**
 * Dates the localStorage cache window must never evict.
 *
 * The session cache only keeps a recent window (see useSessionStore), but a
 * day with unpushed work still has to survive a reload: when the sync layer
 * replays a queued day it treats "nothing locally" as a deliberate whole-day
 * delete, so evicting a queued or tombstoned day would delete it from the
 * database. Owned here rather than in the sync module so the store can read it
 * without importing the sync layer, which imports the store.
 */
export const pinnedDates = new Set<string>();
