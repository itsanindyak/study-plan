import { useQuoteStore } from '@/store/useQuoteStore';

export type QuoteCardVariant = 'surface' | 'featured' | 'accent';

export function QuoteCard({ variant = 'surface' }: { variant?: QuoteCardVariant } = {}) {
  const quote = useQuoteStore((s) => s.text);
  return (
    <div className={`bento-card quote-card quote-card--${variant}`}>
      <div className="quote-card-body">
        {quote ? (
          <blockquote className="quote-card-text" title={quote}>
            <span className="quote-card-mark quote-card-mark--open">&ldquo;</span>
            <span className="quote-card-text-inner">{quote}</span>
            <span className="quote-card-mark quote-card-mark--close">&rdquo;</span>
          </blockquote>
        ) : (
          <div className="quote-card-empty">
            No quote yet &mdash; add one in <em>Settings &rarr; quote</em>
          </div>
        )}
      </div>
    </div>
  );
}
