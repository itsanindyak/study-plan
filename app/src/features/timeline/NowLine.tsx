import { useEffect, useState } from 'react';
import { isToday } from '@/lib/date';

const TL_START = 6;
const TL_END = 24;
const HOUR_H_FALLBACK = 56;

export function NowLine({ date }: { date: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isToday(new Date(date + 'T00:00:00'))) return;
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [date]);

  const selDate = new Date(date + 'T00:00:00');
  if (!isToday(selDate)) return null;

  const nowM = now.getHours() * 60 + now.getMinutes();
  if (nowM < TL_START * 60 || nowM >= TL_END * 60) return null;

  const hourH =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hour-h')) ||
    HOUR_H_FALLBACK;
  const top = ((nowM - TL_START * 60) / 60) * hourH;

  return <div className="now-line" style={{ top: `${top}px` }} />;
}
