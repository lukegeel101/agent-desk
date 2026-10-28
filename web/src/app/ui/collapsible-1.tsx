import type { ReactNode } from 'react';
import { ChevronsUpDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// Watermelon collapsible-1 (titled row with an up-down chevron that reveals bordered items), reused for
// steps taken, scripts, error output and older messages.
const Collapsible1 = ({
  title,
  children,
  defaultOpen = false,
  className,
  contentClassName,
  titleClassName,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
}) => {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn('flex w-full flex-col gap-1.5', className)}>
      <CollapsibleTrigger
        className={cn(
          'group flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          titleClassName,
        )}
      >
        <ChevronsUpDownIcon className="size-3.5" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('border-border/70 rounded-md border px-3 py-2 text-sm', contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default Collapsible1;
