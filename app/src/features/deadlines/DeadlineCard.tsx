import { useDeadlineStore, daysUntil } from '@/store/useDeadlineStore';
import { useDigestStore } from '@/store/useDigestStore';
import { nextStatus } from '@/lib/status';
import type { Deadline } from '@/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function formatDue(d: Deadline): { html: string; overdue: boolean } {
  if (d.status === 'done') {
    const at = d.completedAt ?? Date.now();
    return { html: `<span class="due done-on">done on ${fmtDateShort(at)}</span>`, overdue: false };
  }
  if (d.status === 'notdone') {
    return { html: `<span class="due notdone-tag">✕ not done</span>`, overdue: false };
  }
  const days = daysUntil(d.dueDate);
  if (days < 0) {
    const over = Math.abs(days);
    return {
      html: `<span class="due">${d.dueDate}</span><span class="overdue-tag">${
        over === 1 ? '1 day overdue' : `${over} days overdue`
      }</span>`,
      overdue: true,
    };
  }
  if (days === 0) return { html: '<span class="due">today</span>', overdue: false };
  if (days === 1) return { html: '<span class="due">tomorrow</span>', overdue: false };
  return { html: `<span class="due">in ${days} days</span>`, overdue: false };
}

export function DeadlineCard({
  deadline,
  onOpenDigest,
}: {
  deadline: Deadline;
  origIdx?: number;
  onOpenDigest?: () => void;
}) {
  const setStatus = useDeadlineStore((s) => s.setStatus);
  const remove = useDeadlineStore((s) => s.remove);
  const digestTime = useDigestStore((s) => s.config.time);
  const digestEnabled = useDigestStore((s) => s.config.enabled);
  const { html, overdue } = formatDue(deadline);

  const className =
    'dl' +
    (deadline.status === 'done' ? ' done' : '') +
    (deadline.status === 'notdone' ? ' notdone' : '') +
    (overdue && deadline.status === 'pending' ? ' overdue' : '');

  return (
    <div className={className}>
      <button
        type="button"
        className={'dl-check' + (deadline.status === 'done' ? ' checked' : '')}
        onClick={() => setStatus(deadline.id, nextStatus(deadline.status, 'done'))}
        aria-label="mark complete"
        aria-pressed={deadline.status === 'done'}
      />
      <button
        type="button"
        className={'dl-notdone' + (deadline.status === 'notdone' ? ' active' : '')}
        onClick={() => setStatus(deadline.id, nextStatus(deadline.status, 'notdone'))}
        aria-label="mark not done"
        aria-pressed={deadline.status === 'notdone'}
      />
      <div className="dl-body">
        <div className="dl-title">{deadline.title}</div>
        <div className="dl-meta" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {onOpenDigest && (
        <button
          type="button"
          className={'dl-alarm' + (digestEnabled ? '' : ' off')}
          onClick={onOpenDigest}
          aria-label={`daily digest email settings, currently ${digestEnabled ? 'on' : 'off'} at ${digestTime}`}
          title={`daily digest email · ${digestEnabled ? digestTime : 'off'}`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5" />
            <path d="M5 3 2 6" />
            <path d="m22 6-3-3" />
          </svg>
          {digestTime}
        </button>
      )}
      <button
        type="button"
        className="dl-del"
        onClick={() => remove(deadline.id)}
        aria-label="delete"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}
