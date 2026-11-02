import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, STATUS_CLASSES } from './constants';
import type { TaskStatus } from '@/types/task';

type Props<S extends TaskStatus> = {
  value: S;
  options: readonly S[];
  onChange: (status: S) => void;
  className?: string;
};

export function StatusPicker<S extends TaskStatus>({ value, options, onChange, className }: Props<S>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={cn(
          'flex items-center gap-1 border bg-accent/30 text-xs tracking-widest px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          STATUS_CLASSES[value],
          className,
        )}
      >
        {STATUS_LABELS[value]}
        <ChevronDown className="w-3 h-3 shrink-0" strokeWidth={1.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={() => s !== value && onChange(s)}
            className={cn(s === value && 'text-primary')}
          >
            {STATUS_LABELS[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
