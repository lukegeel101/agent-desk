import type { ReactNode } from 'react';
import { MdError } from 'react-icons/md';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

// Watermelon alert-25 (borderless soft red error callout), for refused actions, failed runs and blocked Go live cards.
const Alert25 = ({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) => {
  return (
    <Alert className={cn('bg-destructive/10 text-destructive border-none', className)}>
      <MdError className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription className="text-destructive/80">{children}</AlertDescription>}
    </Alert>
  );
};

export default Alert25;
