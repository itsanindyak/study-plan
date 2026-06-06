import { DAYS_SHORT, isToday } from '@/lib/date';
import { useSessionStore } from '@/store/useSessionStore';
import { addDays, dateKey } from '@/lib/date';

export function DayStrip({
  weekStart,
  selectedDayIndex,
  onSelect,
}: {
  weekStart: Date;
  selectedDayIndex: number;
  onSelect: (i: number) => void;
}) {
  const sessions = useSessionStore((s) => s.sessions);

  return (
    <div className="day-strip" id="dayStrip">
      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const key = dateKey(date);
        const list = sessions[key] ?? [];
        const done = list.filter((s) => s.done).length;
        const total = list.length;
        const pct = total > 0 ? (done / total) * 100 : 0;
        const isSelected = i === selectedDayIndex;
        const today = isToday(date);

        return (
          <button
            type="button"
            key={i}
            className={
              'day-chip' + (isSelected ? ' active' : '') + (today ? ' today' : '')
            }
            style={{ ['--i' as string]: i }}
            onClick={() => onSelect(i)}
          >
            <div className="dc-name">{DAYS_SHORT[i]}</div>
            <div className="dc-num">{date.getDate()}</div>
            <div className="dc-bar">
              <div className="dc-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
