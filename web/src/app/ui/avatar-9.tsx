import type { ReactNode } from 'react';

import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

// Watermelon avatar-9 (rounded-square avatar with a corner status dot). On the page it marks who sent a
// message or where a conversation came from; the dot shows a run that is working or waiting.
const DOTS = {
  sky: 'bg-sky-500 dark:bg-sky-400',
  amber: 'bg-amber-600 dark:bg-amber-400',
  red: 'bg-red-600 dark:bg-red-400',
  pink: 'bg-pink-600 dark:bg-pink-400',
} as const;

const Avatar9 = ({
  children,
  status,
  statusLabel,
  live = false,
  className,
  fallbackClassName,
  size = 'default',
}: {
  children: ReactNode;
  status?: keyof typeof DOTS;
  statusLabel?: string;
  live?: boolean;
  className?: string;
  fallbackClassName?: string;
  size?: 'sm' | 'default' | 'lg';
}) => {
  return (
    <Avatar size={size} className={cn('rounded-md after:rounded-md', className)}>
      <AvatarFallback className={cn('rounded-md text-[11px] font-semibold', fallbackClassName)}>
        {children}
      </AvatarFallback>
      {status && (
        <AvatarBadge className={cn('top-0 right-0 bottom-auto translate-x-1/4 -translate-y-1/4', DOTS[status], live && 'animate-pulse motion-reduce:animate-none')}>
          <span className="sr-only">{statusLabel}</span>
        </AvatarBadge>
      )}
    </Avatar>
  );
};

export default Avatar9;
