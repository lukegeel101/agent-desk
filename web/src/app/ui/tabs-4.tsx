import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// Watermelon tabs-4 (pill tabs with a count on each), controlled and without panels: the page uses it
// as the conversation filter. `alert` turns a non-zero count amber and bold so "Needs you" stands out.
export interface Tabs4Item {
  value: string;
  label: string;
  count?: number;
  alert?: boolean;
  title?: string;
}

const Tabs4 = ({
  items,
  value,
  onValueChange,
  label,
}: {
  items: Tabs4Item[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
}) => {
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(String(v))} className="w-full gap-0">
      {/* One line in a ~330 px sidebar, so counts are plain numbers and the padding is tight. It wraps (never hides a
          tab) on a very narrow phone. */}
      <div className="bg-muted/60 w-fit max-w-full rounded-[18px] p-0.5">
        <TabsList aria-label={label} className="flex h-auto! max-w-full flex-wrap justify-start gap-0 border-none bg-transparent p-0 shadow-none">
          {items.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              title={tab.title}
              className="group h-7 flex-none gap-[3px] rounded-full px-[5px] text-[12px] font-medium transition-all data-active:bg-background data-active:text-primary data-active:shadow-sm dark:data-active:border-transparent dark:data-active:bg-muted dark:data-active:text-foreground"
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    tab.alert && tab.count > 0
                      ? 'font-semibold text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground group-data-active:text-primary dark:group-data-active:text-foreground',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
};

export default Tabs4;
