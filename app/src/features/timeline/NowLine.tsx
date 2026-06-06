import { useEffect, useState } from 'react';
import { dateKey } from '@/lib/date';

const TL_START = 6;
const TL_END = 30;
const HOUR_H_FALLBACK = 56;

export function NowLine({ date }: { date: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timelineDate = new Date();
    if (timelineDate.getHours() < 6) {
      timelineDate.setDate(timelineDate.getDate() - 1);
    }
    if (date !== dateKey(timelineDate)) return;

    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [date]);

  const timelineDate = new Date(now);
  if (timelineDate.getHours() < 6) {
    timelineDate.setDate(timelineDate.getDate() - 1);
  }
  const timelineDateKey = dateKey(timelineDate);

  if (date !== timelineDateKey) return null;

  let nowM = now.getHours() * 60 + now.getMinutes();
  if (now.getHours() < 6) {
    nowM += 24 * 60;
  }

  if (nowM < TL_START * 60 || nowM >= TL_END * 60) return null;

  const hourH =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hour-h')) ||
    HOUR_H_FALLBACK;
  const top = ((nowM - TL_START * 60) / 60) * hourH;

  return <div className="now-line" style={{ top: `${top}px` }} />;
}
