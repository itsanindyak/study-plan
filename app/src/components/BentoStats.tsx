import { useMemo } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import type { DateKey } from '@/types';
import { Clock } from './Clock';

export function BentoStats({ weekStart }: { weekStart: Date }) {
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

  return (
    <div className="bento">
      <div className="bento-card featured">
        <div className="bento-label">
          <span className="bento-icon">⏱</span>
          this week
        </div>
        <div className="bento-value">
          <span id="statTotal">{(stats.totalMin / 60).toFixed(1)}</span>
          <span className="bento-unit">hrs</span>
        </div>
        <div className="bento-progress">
          <div className="bento-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Clock />

      <div className="bento-card completed-card">
        <div className="bento-label">
          <span
            className="bento-icon"
            style={{ background: 'rgba(34,139,90,0.12)', color: '#228b5a' }}
          >
            ✓
          </span>
          completed
        </div>
        <div className="bento-value">
          <span>{stats.doneCount}</span>
          <span className="bento-unit">
            / <span>{stats.totalCount}</span> sessions
          </span>
        </div>
        <div className="bento-progress completed-bar">
          <div className="bento-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="bento-foot">
          {(stats.doneMin / 60).toFixed(1)} hrs finished · {stats.totalCount - stats.doneCount} to go
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
