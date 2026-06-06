import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { BentoStats } from '@/components/BentoStats';
import { DayStrip } from '@/components/DayStrip';
import { SessionList } from '@/features/sessions/SessionList';
import { AddSessionForm } from '@/features/sessions/AddSessionForm';
import { DeadlinesView } from '@/features/deadlines/DeadlinesView';
import { Timeline } from '@/features/timeline/Timeline';
import { SessionPopup } from '@/components/SessionPopup';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { useCloudSync } from '@/features/sync/useCloudSync';
import { useSessionStore } from '@/store/useSessionStore';
import { useDeadlineStore } from '@/store/useDeadlineStore';
import { DAYS, MONTHS, addDays, dateKey, getWeekStart, todayMondayIndex } from '@/lib/date';
import type { Session } from '@/types';

export function App() {
  useCloudSync();

  // initial day = today (only on first mount)
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(todayMondayIndex());

  const [openSession, setOpenSession] = useState<{ date: string; session: Session } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const daySessions = useSessionStore((s) => s.sessions[selectedKey]) ?? [];

  const { totalMin, completedMin } = useMemo(() => {
    let tMin = 0;
    let cMin = 0;
    for (const s of daySessions) {
      const d = parseInt(String(s.duration)) || 0;
      tMin += d;
      if (s.done) {
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

  return (
    <div className="app">
      <Topbar
        weekStart={weekStart}
        onPrevWeek={goPrevWeek}
        onNextWeek={goNextWeek}
        onOpenSettings={() => setSettingsOpen(true)}
      />

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
                : `${daySessions.length} session${daySessions.length === 1 ? '' : 's'} · ${daySessions.filter((s) => s.done).length} done`}
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
              <span className="th-count">
                <strong>{daySessions.filter((s) => s.done).length}</strong>/
                <span>{daySessions.length}</span> done
                <span style={{ opacity: 0.35, margin: '0 6px' }}>·</span>
                <strong>{(completedMin / 60).toFixed(1)}</strong>/
                <span>{(totalMin / 60).toFixed(1)}</span> hrs
              </span>
            </div>
            <Timeline
              date={selectedKey}
              onOpenSession={(s) => setOpenSession({ date: selectedKey, session: s })}
            />
          </div>
        </div>
      </div>

      <div className="footer">local-first · syncs to cloud when connected</div>

      {openSession && (
        <SessionPopup
          date={openSession.date}
          session={openSession.session}
          onClose={() => setOpenSession(null)}
        />
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
