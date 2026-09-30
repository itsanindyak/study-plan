import { useEffect } from 'react';
import { DigestControls } from './DigestControls';

export function DigestTimeModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="popup-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="popup" role="dialog" aria-label="daily digest email">
        <div className="popup-head">
          <div className="popup-swatch" style={{ background: 'var(--accent)' }} />
          <div className="popup-title">
            <h3>daily digest email</h3>
            <div className="pt-sub">a morning summary of deadlines + today’s sessions</div>
          </div>
          <button className="popup-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <DigestControls />
      </div>
    </div>
  );
}
