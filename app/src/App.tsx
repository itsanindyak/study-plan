import { AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { BentoStats } from '@/components/BentoStats';
import { DayStrip } from '@/components/DayStrip';
import { SessionList } from '@/features/sessions/SessionList';
import { AddSessionForm } from '@/features/sessions/AddSessionForm';
import { DeadlinesView } from '@/features/deadlines/DeadlinesView';
import { Timeline } from '@/features/timeline/Timeline';
import { WeeklyScheduleModal } from '@/features/timeline/WeeklyScheduleModal';
import { SessionPopup } from '@/components/SessionPopup';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { useCloudSync, useSyncPill, refreshFromCloud, ensureDateLoaded } from '@/features/sync/useCloudSync';
import { useSessionStore } from '@/store/useSessionStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import { useSettingsStore, selectIsConfigured } from '@/store/useSettingsStore';
import { DAYS, MONTHS, addDays, dateKey, getWeekStart, todayMondayIndex } from '@/lib/date';
import type { Session } from '@/types';

export function App() {
  useCloudSync();

  // initial day = today (only on first mount)
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(todayMondayIndex());

  const [openSession, setOpenSession] = useState<{ date: string; session: Session } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);

  const configured = useSettingsStore(selectIsConfigured);
  const { state: syncState, booting, origin, lastCloudAt, lastError, hasCache } = useSyncPill();

  // auto-cleanup deadlines on mount (3-days-past purge) so the UI is tidy
  // before the cloud pull potentially replaces them.
  useEffect(() => {
    useDeadlineStore.getState().cleanup();
  }, []);

  const weekStart = useMemo(() => getWeekStart(weekOffset), [weekOffset]);
  const selectedDate = useMemo(() => addDays(weekStart, selectedDayIndex), [
    weekStart,
    selectedDayIndex,
  ]);
  const selectedKey = useMemo(() => dateKey(selectedDate), [selectedDate]);

  // the cache only holds recent days, so an older week gets pulled on demand
  useEffect(() => {
    for (let i = 0; i < DAYS.length; i++) void ensureDateLoaded(dateKey(addDays(weekStart, i)));
  }, [weekStart]);

  const daySessions = useSessionStore((s) => s.sessions[selectedKey]) ?? [];

  const { totalMin, completedMin } = useMemo(() => {
    let tMin = 0;
    let cMin = 0;
    for (const s of daySessions) {
      const d = parseInt(String(s.duration)) || 0;
      tMin += d;
      if (s.status === 'done') {
        cMin += d;
      }
    }
    return { totalMin: tMin, completedMin: cMin };
  }, [daySessions]);

  const goPrevWeek = () => {
    setWeekOffset((w) => w - 1);
    setSelectedDayIndex(0);
  };
  const goNextWeek = () => {
    setWeekOffset((w) => w + 1);
    setSelectedDayIndex(0);
  };

  // cloud-first: with a token set, nothing is shown until the database has
  // been read once, because until then there is no way to tell cache from truth
  if (configured && booting) {
    return (
      <div className="boot-gate">
        <div className="boot-mark" />
        <p>reading your plan from the cloud…</p>
      </div>
    );
  }

  const offlineCache = configured && origin === 'cache';
  const cachedAt = lastCloudAt
    ? new Date(lastCloudAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const reason = lastError ? ` (${lastError})` : '';
  const bannerText =
    syncState === 'syncing'
      ? 'reconnecting to the cloud…'
      : hasCache
        ? `cloud not reachable${reason} — still showing the copy cached ${
            cachedAt ? `at ${cachedAt}` : 'earlier'
          }. edits are queued and upload once the connection is back.`
        : `cloud not reachable${reason} — nothing is cached on this device yet, so there is nothing to show.`;

  return (
    <div className="app">
      <Topbar
        weekStart={weekStart}
        onPrevWeek={goPrevWeek}
        onNextWeek={goNextWeek}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {offlineCache && (
        <div className="offline-banner" role="status">
          <span>{bannerText}</span>
          <button
            type="button"
            disabled={syncState === 'syncing'}
            onClick={() => void refreshFromCloud()}
          >
            retry
          </button>
        </div>
      )}

      <BentoStats weekStart={weekStart} selectedKey={selectedKey} />

      <DayStrip
        weekStart={weekStart}
        selectedDayIndex={selectedDayIndex}
        onSelect={setSelectedDayIndex}
      />

      <div className="body-grid">
        <div className="left-col">
          <div className="day-header">
            <h2>
              {DAYS[selectedDayIndex]}{' '}
              <span>
                {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]}
              </span>
            </h2>
            <span className="count">
              {daySessions.length === 0
                ? 'no sessions'
                : `${daySessions.length} session${daySessions.length === 1 ? '' : 's'} · ${daySessions.filter((s) => s.status === 'done').length} done`}
            </span>
          </div>

          <SessionList
            date={selectedKey}
            onOpenSession={(s) => setOpenSession({ date: selectedKey, session: s })}
          />

          <AddSessionForm selectedDate={selectedKey} />

          <DeadlinesView />
        </div>

        <div className="right-col">
          <div className="timeline-card">
            <div className="timeline-head">
              <span className="th-label">timeline</span>
              <span className="th-count" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <strong>{daySessions.filter((s) => s.status === 'done').length}</strong>/
                <span>{daySessions.length}</span> done
                <span style={{ opacity: 0.35, margin: '0 4px' }}>·</span>
                <strong>{(completedMin / 60).toFixed(1)}</strong>/
                <span>{(totalMin / 60).toFixed(1)}</span> hrs
                <button
                  className="timeline-extend-btn"
                  onClick={() => setWeeklyOpen(true)}
                  title="Show weekly schedule"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0.2rem',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    color: 'var(--text-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    transition: 'color 0.2s, background 0.2s',
                    marginLeft: '2px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--accent)';
                    e.currentTarget.style.background = 'var(--accent-soft)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-3)';
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </button>
              </span>
            </div>
            <Timeline
              date={selectedKey}
              onOpenSession={(s) => setOpenSession({ date: selectedKey, session: s })}
            />
          </div>
        </div>
      </div>

      <div className="footer">
        {configured
          ? 'cloud is the source of truth · this device keeps a cache for offline'
          : 'local-first · syncs to cloud when connected'}
      </div>

      <AnimatePresence>
        {openSession && (
          <SessionPopup
            key="session-popup"
            date={openSession.date}
            session={openSession.session}
            onClose={() => setOpenSession(null)}
          />
        )}
      </AnimatePresence>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <WeeklyScheduleModal
        open={weeklyOpen}
        weekStart={weekStart}
        onClose={() => setWeeklyOpen(false)}
        onOpenSession={(dateKey, session) => setOpenSession({ date: dateKey, session })}
      />
    </div>
  );
}
