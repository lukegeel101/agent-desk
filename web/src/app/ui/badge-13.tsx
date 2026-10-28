import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

// Watermelon badge-13 (soft red status pill), used for failed and stopped runs.
const Badge13 = ({ children, title }: { children: ReactNode; title?: string }) => {
  return (
    <Badge title={title} className="bg-destructive/10 [a&]:hover:bg-destructive/5 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive border-none focus-visible:outline-none">
      <span className="bg-destructive size-2 rounded-full" aria-hidden="true" />
      {children}
    </Badge>
  );
};

export default Badge13;
