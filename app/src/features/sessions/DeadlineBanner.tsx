import { useDeadlineStore, daysUntil } from '@/store/useDeadlineStore';
import { nextStatus } from '@/lib/status';
import type { Deadline } from '@/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function dueLabel(d: Deadline): { text: string; urgent: boolean } {
  if (d.status === 'done') {
    const at = d.completedAt ?? Date.now();
    return { text: `done on ${fmtDateShort(at)}`, urgent: false };
  }
  if (d.status === 'notdone') {
    return { text: '✕ not done', urgent: false };
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
  const setStatus = useDeadlineStore((s) => s.setStatus);
  const { text, urgent } = dueLabel(deadline);

  const className =
    'dl-banner' +
    (urgent ? ' urgent' : '') +
    (deadline.status === 'done' ? ' done' : '') +
    (deadline.status === 'notdone' ? ' notdone' : '');

  return (
    <div className={className}>
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
        className={'dl-banner-check' + (deadline.status === 'done' ? ' checked' : '')}
        onClick={() => setStatus(deadline.id, nextStatus(deadline.status, 'done'))}
        aria-label="mark as done"
        aria-pressed={deadline.status === 'done'}
        title={deadline.status === 'done' ? 'Clear done' : 'Mark as done'}
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
      <button
        type="button"
        className={'dl-banner-notdone' + (deadline.status === 'notdone' ? ' active' : '')}
        onClick={() => setStatus(deadline.id, nextStatus(deadline.status, 'notdone'))}
        aria-label="mark as not done"
        aria-pressed={deadline.status === 'notdone'}
        title={deadline.status === 'notdone' ? 'Clear not done' : 'Mark as not done'}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
