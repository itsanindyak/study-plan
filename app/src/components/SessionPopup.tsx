import { useEffect } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { fmtTime12, minToTime, timeToMin, fmtDuration } from '@/lib/time';
import { shade } from '@/lib/color';
import type { Session } from '@/types';

export function SessionPopup({
  date,
  session,
  onClose,
}: {
  date: string;
  session: Session;
  onClose: () => void;
}) {
  const toggleDone = useSessionStore((s) => s.toggleDone);
  const remove = useSessionStore((s) => s.remove);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dur = parseInt(String(session.duration)) || 0;
  const startM = timeToMin(session.time);
  const endM = startM + dur;

  const onDone = () => {
    toggleDone(date, session.id);
    onClose();
  };
  const onDelete = () => {
    remove(date, session.id);
    onClose();
  };

  return (
    <div
      className="popup-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="popup" role="dialog" aria-modal="true">
        <div className="popup-head">
          <div
            className="popup-swatch"
            style={{
              background: `linear-gradient(135deg, ${session.color}, ${shade(session.color, -18)})`,
            }}
          />
          <div className="popup-title">
            <h3>{session.topic || session.subject}</h3>
            <div className="pt-sub">{session.subject}</div>
          </div>
          <button className="popup-close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="popup-row">
          <span className="pr-label">start</span>
          <span className="pr-value">{fmtTime12(session.time)}</span>
        </div>
        <div className="popup-row">
          <span className="pr-label">end</span>
          <span className="pr-value">{fmtTime12(minToTime(endM))}</span>
        </div>
        <div className="popup-row">
          <span className="pr-label">duration</span>
          <span className="pr-value">{fmtDuration(dur)} ({dur} min)</span>
        </div>
        <div className="popup-row">
          <span className="pr-label">status</span>
          <span className="pr-value">{session.done ? '✓ completed' : '○ pending'}</span>
        </div>
        <div className="popup-hex">
          <div className="ph-dot" style={{ background: session.color }} />
          <span>{session.color.toUpperCase()}</span>
        </div>
        <div className="popup-actions">
          <button className="pa-done" onClick={onDone}>
            {session.done ? '↺ mark pending' : '✓ mark done'}
          </button>
          <button className="pa-del" onClick={onDelete}>delete</button>
        </div>
      </div>
    </div>
  );
}
