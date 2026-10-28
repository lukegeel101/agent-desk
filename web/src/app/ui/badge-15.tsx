import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

// Watermelon badge-15 (soft green status pill), used for finished replies and passed checks.
const Badge15 = ({ children, title }: { children: ReactNode; title?: string }) => {
  return (
    <Badge title={title} className="border-none bg-green-600/10 text-green-700 focus-visible:ring-green-600/20 focus-visible:outline-none dark:bg-green-400/10 dark:text-green-400 dark:focus-visible:ring-green-400/40">
      <span
        className="size-2 rounded-full bg-green-600 dark:bg-green-400"
        aria-hidden="true"
      />
      {children}
    </Badge>
  );
};

export default Badge15;
