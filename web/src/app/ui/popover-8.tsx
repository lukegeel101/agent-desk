import { useState, type ReactElement } from 'react';
import { PencilIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

// Watermelon popover-8 (notes popover with a textarea and Discard / Save), turned into the Rename box.
// Enter saves, Escape closes, and the draft starts from the current title each time it opens.
const Popover8 = ({
  value,
  trigger,
  onSave,
}: {
  value: string;
  trigger: ReactElement;
  onSave: (title: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const save = () => {
    onSave(draft.trim());
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value);
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-80 rounded-3xl border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-base font-bold text-neutral-900 dark:text-neutral-100">Rename this conversation</Label>
            <p className="text-[11px] leading-tight font-medium text-neutral-500">
              Your title replaces the automatic one everywhere and is never rewritten by it.
            </p>
          </div>

          <Textarea
            autoFocus
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
            aria-label="Conversation title"
            className="min-h-[72px] resize-none rounded-2xl border-neutral-100 bg-neutral-50 p-3 text-sm font-medium focus-visible:ring-0 dark:border-neutral-800 dark:bg-neutral-900"
          />

          <div className="grid w-full grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-9 rounded-2xl border-neutral-200 text-xs font-bold text-neutral-500 dark:border-neutral-800"
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!draft.trim()}
              className="h-9 gap-2 rounded-2xl border-none bg-emerald-600 text-xs font-bold text-white shadow-lg shadow-emerald-500/10 hover:bg-emerald-700"
            >
              <PencilIcon className="size-3.5" />
              Save title
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default Popover8;
