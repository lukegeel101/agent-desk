import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Watermelon badge-9 (square numeric badge with tabular figures), used for counts.
const Badge9 = ({ children, className, title }: { children: ReactNode; className?: string; title?: string }) => {
  return (
    <Badge title={title} className={cn('h-5 min-w-5 rounded-sm px-1.5 tabular-nums', className)}>
      {children}
    </Badge>
  );
};

export default Badge9;
