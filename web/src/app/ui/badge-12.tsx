import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Watermelon badge-12 (soft status pill with a dot), made reusable for the page:
// `tone` picks the tint and `live` makes the dot pulse while a run is working.
const TONES = {
  sky: {
    pill: 'bg-sky-600/10 text-sky-600 focus-visible:ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-400 dark:focus-visible:ring-sky-400/40',
    dot: 'bg-sky-600 dark:bg-sky-400',
  },
  amber: {
    pill: 'bg-amber-600/10 text-amber-700 focus-visible:ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400',
    dot: 'bg-amber-600 dark:bg-amber-400',
  },
  pink: {
    pill: 'bg-pink-600/10 text-pink-700 focus-visible:ring-pink-600/20 dark:bg-pink-400/10 dark:text-pink-300',
    dot: 'bg-pink-600 dark:bg-pink-400',
  },
  violet: {
    pill: 'bg-violet-600/10 text-violet-700 focus-visible:ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-300',
    dot: 'bg-violet-600 dark:bg-violet-400',
  },
  neutral: {
    pill: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/60',
  },
} as const;

export type Badge12Tone = keyof typeof TONES;

const Badge12 = ({
  children,
  tone = 'sky',
  live = false,
  title,
  className,
}: {
  children: ReactNode;
  tone?: Badge12Tone;
  live?: boolean;
  title?: string;
  className?: string;
}) => {
  const t = TONES[tone];
  return (
    <Badge
      title={title}
      className={cn('border-none focus-visible:outline-none', t.pill, className)}
    >
      <span className="relative flex size-2" aria-hidden="true">
        {live && (
          <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none', t.dot)} />
        )}
        <span className={cn('relative inline-flex size-2 rounded-full', t.dot)} />
      </span>
      {children}
    </Badge>
  );
};

export default Badge12;
