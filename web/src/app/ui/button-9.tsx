import { cn } from '@/lib/utils';

// Watermelon button-9's bouncing dots, lifted out of the disabled button so a running reply can say
// "Working" with the same motion. The dots stop when the system asks for reduced motion.
const Button9 = ({ label, className }: { label: string; className?: string }) => {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      <span>{label}</span>
      <span className="flex translate-y-[4px] gap-[2px]" aria-hidden="true">
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s] motion-reduce:animate-none" />
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s] motion-reduce:animate-none" />
        <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:0s] motion-reduce:animate-none" />
      </span>
    </span>
  );
};

export default Button9;
