import { useDeadlineStore, daysUntil } from '@/store/useDeadlineStore';
import type { Deadline } from '@/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function dueLabel(d: Deadline): { text: string; urgent: boolean } {
  if (d.done) {
    const at = d.completedAt ?? Date.now();
    return { text: `done on ${fmtDateShort(at)}`, urgent: false };
  }
  const days = daysUntil(d.dueDate);
  if (days < 0) {
    const over = Math.abs(days);
    return { text: over === 1 ? '1 day overdue' : `${over} days overdue`, urgent: true };
  }
  if (days === 0) return { text: 'due today', urgent: true };
  if (days === 1) return { text: 'due tomorrow', urgent: false };
  return { text: `due in ${days} days`, urgent: false };
}

export function DeadlineBanner({ deadline }: { deadline: Deadline }) {
  const toggle = useDeadlineStore((s) => s.toggle);
  const { text, urgent } = dueLabel(deadline);

  return (
    <div className={'dl-banner' + (urgent ? ' urgent' : '') + (deadline.done ? ' done' : '')}>
      <span className="dl-banner-tag">
        <span className="dl-banner-dot" />
        DEADLINE
      </span>
      <div className="dl-banner-body">
        <div className="dl-banner-title">{deadline.title}</div>
        <div className="dl-banner-due">{text}</div>
      </div>
      <button
        type="button"
        className={'dl-banner-check' + (deadline.done ? ' checked' : '')}
        onClick={() => toggle(deadline.id)}
        aria-label={deadline.done ? 'mark as not done' : 'mark as done'}
        title={deadline.done ? 'Mark as not done' : 'Mark as done'}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5 12 10 17 19 7" />
        </svg>
      </button>
    </div>
  );
}
