import { useId } from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Watermelon select-10 (rounded dropdown with labelled groups), controlled: the model picker.
export interface Select10Group {
  label: string;
  options: { value: string; label: string }[];
}

const Select10 = ({
  label,
  value,
  onValueChange,
  groups,
  title,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  groups: Select10Group[];
  title?: string;
}) => {
  const id = useId();
  const items = Object.fromEntries(groups.flatMap((g) => g.options.map((o) => [o.value, o.label])));

  return (
    <div className="flex items-center gap-2" title={title}>
      <Label htmlFor={id} className="text-xs text-zinc-600 dark:text-zinc-400">
        {label}
      </Label>
      <Select value={value} items={items} onValueChange={(v) => v && onValueChange(String(v))}>
        <SelectTrigger
          id={id}
          size="sm"
          className="min-w-44 rounded-xl border-zinc-200 bg-white shadow-xs transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          sideOffset={4}
          side="top"
          alignItemWithTrigger={false}
          className="rounded-xl border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          {groups.map((g) => (
            <SelectGroup key={g.label}>
              <SelectLabel className="text-zinc-500">{g.label}</SelectLabel>
              {g.options.map((o) => (
                <SelectItem key={o.value} value={o.value} className="rounded-lg">
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default Select10;
