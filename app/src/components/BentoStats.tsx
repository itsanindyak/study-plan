import { useMemo } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import type { DateKey } from '@/types';
import { Clock } from './Clock';

export function BentoStats({ weekStart, selectedKey }: { weekStart: Date; selectedKey: string }) {
  const sessions = useSessionStore((s) => s.sessions);

  const stats = useMemo(() => {
    let totalMin = 0;
    let doneMin = 0;
    let totalCount = 0;
    let doneCount = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const key: DateKey = dateKey(d);
      const list = sessions[key] ?? [];
      for (const s of list) {
        const m = parseInt(String(s.duration)) || 0;
        totalMin += m;
        totalCount++;
        if (s.done) {
          doneMin += m;
          doneCount++;
        }
      }
    }
    return { totalMin, doneMin, totalCount, doneCount };
  }, [sessions, weekStart]);

  const pct = stats.totalMin > 0 ? (stats.doneMin / stats.totalMin) * 100 : 0;

  // Selected day stats
  const daySessions = sessions[selectedKey] ?? [];
  const dayStats = useMemo(() => {
    let totalMin = 0;
    let doneMin = 0;
    let totalCount = 0;
    let doneCount = 0;
    for (const s of daySessions) {
      const m = parseInt(String(s.duration)) || 0;
      totalMin += m;
      totalCount++;
      if (s.done) {
        doneMin += m;
        doneCount++;
      }
    }
    return { totalMin, doneMin, totalCount, doneCount };
  }, [daySessions]);

  const dayPct = dayStats.totalMin > 0 ? (dayStats.doneMin / dayStats.totalMin) * 100 : 0;

  return (
    <div className="bento">
      <div className="bento-card featured">
        <div className="bento-label">
          <span className="bento-icon">⏱</span>
          this week
        </div>
        <div className="bento-value">
          <span>{(stats.doneMin / 60).toFixed(1)}</span>
          <span className="bento-unit">
            / <span id="statTotal">{(stats.totalMin / 60).toFixed(1)}</span> hrs
          </span>
        </div>
        <div className="bento-progress">
          <div className="bento-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Clock />

      <div className="bento-card featured">
        <div className="bento-label">
          <span className="bento-icon">✓</span>
          completed today
        </div>
        <div className="bento-value">
          <span>{(dayStats.doneMin / 60).toFixed(1)}</span>
          <span className="bento-unit">
            / <span>{(dayStats.totalMin / 60).toFixed(1)}</span> hrs
          </span>
        </div>
        <div className="bento-progress">
          <div className="bento-progress-fill" style={{ width: `${dayPct}%` }} />
        </div>
        <div className="bento-foot" style={{ color: 'rgba(255, 255, 255, 0.65)', marginTop: '0.4rem', position: 'relative', zIndex: 1 }}>
          {dayStats.doneCount} of {dayStats.totalCount} sessions finished
        </div>
      </div>
    </div>
  );
}

function dateKey(date: Date): DateKey {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}
