import { useEffect, useState } from 'react';

export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="bento-card clock-card">
      <div className="bento-label">
        <span className="bento-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          ⏰
        </span>
        now
      </div>
      <div className="digital-clock">
        <div className="dc-time">
          {h}
          <span className="dc-sep">:</span>
          {m}
          <span className="dc-sep">:</span>
          <span className="dc-sec">{s}</span>
        </div>
        <div className="dc-date">{dateStr}</div>
      </div>
    </div>
  );
}
