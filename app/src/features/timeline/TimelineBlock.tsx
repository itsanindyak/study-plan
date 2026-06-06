import type { CSSProperties } from 'react';
import { timeToMin, minToTime, fmtTime12 } from '@/lib/time';
import { shade } from '@/lib/color';
import type { Session } from '@/types';

export function TimelineBlock({
  session,
  lane,
  count,
  hourH,
  tlStart,
  onOpen,
}: {
  session: Session;
  lane: number;
  count: number;
  hourH: number;
  tlStart: number;
  onOpen: () => void;
}) {
  const startM = timeToMin(session.time);
  const dur = parseInt(String(session.duration)) || 60;
  const top = ((startM - tlStart * 60) / 60) * hourH;
  const height = Math.max(32, (dur / 60) * hourH - 4);
  const compact = height < 50;
  const endM = startM + dur;

  const style: CSSProperties = {
    top: `${top}px`,
    height: `${height}px`,
    background: `linear-gradient(135deg, ${session.color}, ${shade(session.color, -18)})`,
  };
  if (count > 1) {
    const leftPct = (lane / count) * 100;
    const widthPct = (1 / count) * 100;
    style.left = `calc(56px + 5px + (100% - 56px - 10px) * ${leftPct / 100})`;
    style.width = `calc((100% - 56px - 10px) * ${widthPct / 100})`;
    style.right = 'auto';
  } else {
    style.left = 'calc(56px + 5px)';
    style.right = '5px';
  }

  return (
    <div
      className={'tl-block' + (session.done ? ' done' : '') + (compact ? ' compact' : '')}
      style={style}
      onClick={onOpen}
      title={`${session.subject} — ${session.topic}\n${fmtTime12(session.time)} – ${fmtTime12(minToTime(endM))}`}
    >
      <div className="tlb-subject">{session.subject}</div>
      <div className="tlb-title">{session.topic || session.subject}</div>
      <div className="tlb-time">
        {fmtTime12(session.time)} – {fmtTime12(minToTime(endM))}
      </div>
    </div>
  );
}
