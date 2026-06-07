import { useMemo } from 'react';
import { HeaderLeft } from './HeaderLeft';
import { SyncPill } from './SyncPill';
import { WeekNav } from './WeekNav';
import { IconButton } from './IconButton';
import { MONTHS, addDays } from '@/lib/date';

export function Topbar({
  weekStart,
  onPrevWeek,
  onNextWeek,
  onOpenSettings,
  onOpenFocus,
}: {
  weekStart: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onOpenSettings: () => void;
  onOpenFocus: () => void;
}) {
  const weekLabel = useMemo(() => {
    const weekEnd = addDays(weekStart, 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    return sameMonth
      ? `${weekStart.getDate()} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
      : `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
  }, [weekStart]);

  return (
    <div className="topbar">
      <HeaderLeft
        actionLabel="focus"
        actionIcon={<span>⚡</span>}
        onAction={onOpenFocus}
        actionTitle="Start Focus Mode"
      />
      <div className="topbar-right">
        <SyncPill onClick={onOpenSettings} />
        <WeekNav
          weekLabel={weekLabel}
          onPrev={onPrevWeek}
          onNext={onNextWeek}
        />
        <IconButton onClick={onOpenSettings} label="cloud settings" title="cloud settings">
          ⚙
        </IconButton>
      </div>
    </div>
  );
}
