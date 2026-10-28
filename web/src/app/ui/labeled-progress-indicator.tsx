'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { FC } from 'react';

// Watermelon labeled-progress-indicator, adapted for a running reply: the label is the step the run is on now
// (it flips in when a new step arrives) and the bar is how much of the 2-hour limit the run has used.
export interface LabeledProgressIndicatorProps {
  label: string;
  progress: number; // 0..1
  warn?: boolean;
}

export const LabeledProgressIndicator: FC<LabeledProgressIndicatorProps> = ({ label, progress, warn = false }) => {
  const still = useReducedMotion();
  const width = `${Math.max(2, Math.min(100, progress * 100)).toFixed(1)}%`;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative flex min-h-5 w-full items-center overflow-hidden perspective-[800px] transform-3d">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={label}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 10, scale: 1.08, filter: 'blur(4px)', rotateX: -60 }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', rotateX: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, filter: 'blur(4px)', rotateX: 90, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 600, damping: 100, mass: 10 }}
            className="block w-full origin-bottom truncate font-mono text-[12.5px] text-zinc-600 will-change-transform transform-3d dark:text-zinc-300"
            title={label}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full border border-black/5 bg-[#F0F0F0] shadow-inner dark:border-white/5 dark:bg-zinc-900">
        <motion.div
          initial={false}
          animate={{ width }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className={`relative h-full overflow-hidden rounded-full ${warn ? 'bg-amber-500' : 'bg-[#016FFE] dark:bg-blue-600'}`}
        >
          {!still && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '200%' }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-y-0 w-full bg-linear-to-r from-zinc-900/10 via-sky-300 to-zinc-900/10"
            />
          )}
        </motion.div>
      </div>
    </div>
  );
};
