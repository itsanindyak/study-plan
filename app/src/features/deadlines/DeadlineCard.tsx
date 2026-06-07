import { useDeadlineStore, daysUntil } from '@/store/useDeadlineStore';
import type { Deadline } from '@/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateShort(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function formatDue(d: Deadline): { html: string; overdue: boolean } {
  if (d.done) {
    const at = d.completedAt ?? Date.now();
    return { html: `<span class="due done-on">done on ${fmtDateShort(at)}</span>`, overdue: false };
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

export function DeadlineCard({ deadline }: { deadline: Deadline; origIdx?: number }) {
  const toggle = useDeadlineStore((s) => s.toggle);
  const remove = useDeadlineStore((s) => s.remove);
  const { html, overdue } = formatDue(deadline);

  return (
    <div
      className={
        'dl' + (deadline.done ? ' done' : '') + (overdue && !deadline.done ? ' overdue' : '')
      }
    >
      <button
        type="button"
        className={'dl-check' + (deadline.done ? ' checked' : '')}
        onClick={() => toggle(deadline.id)}
        aria-label={deadline.done ? 'mark incomplete' : 'mark complete'}
      />
      <div className="dl-body">
        <div className="dl-title">{deadline.title}</div>
        <div className="dl-meta" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <button
        type="button"
        className="dl-del"
        onClick={() => remove(deadline.id)}
        aria-label="delete"
      >
        ✕
      </button>
    </div>
  );
}
