import type { ReactElement, ReactNode } from 'react';
import { MdLightbulb } from 'react-icons/md';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Watermelon tooltip-8 (tip tooltip with a lightbulb), taking any trigger element: keyboard and shell hints.
const Tooltip8 = ({
  trigger,
  children,
  side = 'top',
}: {
  trigger: ReactElement;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) => {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent side={side} className="max-w-80">
        <div className="flex items-start gap-1.5">
          <MdLightbulb className="mt-0.5 size-4 shrink-0 text-yellow-400" />
          <div className="leading-relaxed">{children}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

export default Tooltip8;
