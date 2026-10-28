import type { ComponentProps } from 'react';

import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Watermelon textarea-14 (auto-growing textarea), used as the message box. It grows with the text up to a cap.
const Textarea14 = ({ className, ...props }: ComponentProps<'textarea'>) => {
  return (
    <Textarea
      {...props}
      className={cn(
        'focus-visible:ring-primary/20 focus-visible:border-primary/50 field-sizing-content max-h-64 min-h-16 resize-none rounded-xl px-3 py-2.5 text-[14px] shadow-sm',
        className,
      )}
    />
  );
};

export default Textarea14;
