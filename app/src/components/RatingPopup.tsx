import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useSessionStore } from '@/store/useSessionStore';

// Day rating popup: a bar split into 10 segments. Clicking a segment saves
// that rating for the day and closes immediately ("declare" in one tap).
// Clearing un-rates the day. Rating edits flow through the normal dirty-date
// queue — the flush pushes the whole day (sessions + rating) in one PUT.
export function RatingPopup({
  date,
  onClose,
}: {
  date: string;
  onClose: () => void;
}) {
  const current = useSessionStore((s) => s.ratings[date]?.value ?? null);
  const setRating = useSessionStore((s) => s.setRating);
  const [hover, setHover] = useState<number | null>(null);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = hover ?? current ?? 0;
  const [y, m, d] = date.split('-').map(Number);
  const label = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  const pick = (n: number) => {
    setRating(date, n);
    onClose();
  };
  const clear = () => {
    setRating(date, null);
    onClose();
  };

  return (
    <motion.div
      className="popup-backdrop"
      style={{ zIndex: 250 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="popup"
        role="dialog"
        aria-modal="true"
        aria-label={`Rate ${label}`}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="popup-head">
          <div className="popup-title">
            <h3>rate this day</h3>
            <div className="pt-sub">{label}</div>
          </div>
          <button className="popup-close" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="rate-num" aria-live="polite">
          {shown > 0 ? shown : '–'}
          <span className="rate-denom">/10</span>
        </div>

        <div className="rate-bar" role="group" aria-label="day rating 1 to 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={'rate-seg' + (n <= shown ? ' lit' : '')}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onClick={() => pick(n)}
              aria-label={`rate ${n} out of 10`}
              title={`${n}/10`}
            >
              {n}
            </button>
          ))}
        </div>

        {current != null && (
          <button type="button" className="rate-clear" onClick={clear}>
            clear rating
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
