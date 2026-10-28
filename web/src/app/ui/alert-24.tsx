import type { ReactNode } from 'react';
import { GoAlertFill } from 'react-icons/go';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

// Watermelon alert-24 (borderless soft yellow warning callout), widened to hold the "What you need to do" list.
const Alert24 = ({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) => {
  return (
    <Alert role="region" className={cn('border-none bg-yellow-600/10 px-4 py-3 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-300', className)}>
      <GoAlertFill className="size-4" />
      <div className="col-start-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <AlertTitle className="text-[15px] font-semibold">{title}</AlertTitle>
          {description && (
            <AlertDescription className="text-yellow-800/80 dark:text-yellow-300/80">{description}</AlertDescription>
          )}
        </div>
        {action}
      </div>
      {children && <div className="col-start-2 mt-2 text-foreground">{children}</div>}
    </Alert>
  );
};

export default Alert24;
