import type { ReactNode } from 'react';
import { IoCheckmarkDoneOutline } from 'react-icons/io5';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Watermelon button-37 (soft green double-check button), given a visible label for "Mark done".
const Button37 = ({
  children,
  onClick,
  className,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
  title?: string;
}) => {
  return (
    <Button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'gap-1.5 bg-green-600/10 text-green-700 hover:bg-green-600/20 focus-visible:ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:hover:bg-green-400/20 dark:focus-visible:ring-green-400/40',
        className,
      )}
    >
      <IoCheckmarkDoneOutline className="size-4" />
      {children}
    </Button>
  );
};

export default Button37;
