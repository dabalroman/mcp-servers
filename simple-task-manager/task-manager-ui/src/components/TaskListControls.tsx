import { ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { GroupBy, SortBy, SortDir, ViewState } from '@/lib/taskView';
import { DEFAULT_VIEW } from '@/lib/taskView';

type Props = {
  value: ViewState;
  onChange: (v: ViewState) => void;
};

const STORAGE_KEY = 'task-manager-ui:view';

export function loadViewState(): ViewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    return {
      groupBy:  (parsed.groupBy  as GroupBy)  ?? DEFAULT_VIEW.groupBy,
      groupDir: (parsed.groupDir as SortDir)  ?? DEFAULT_VIEW.groupDir,
      sortBy:   (parsed.sortBy   as SortBy)   ?? DEFAULT_VIEW.sortBy,
      sortDir:  (parsed.sortDir  as SortDir)  ?? DEFAULT_VIEW.sortDir,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function saveViewState(v: ViewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore quota errors
  }
}

const KEY_CELL = 'flex items-center px-3 py-2 text-2xs tracking-widest uppercase text-muted-foreground bg-card border-r border-border select-none whitespace-nowrap';
const VAL_SELECT = 'flex items-center justify-between gap-2 px-3 py-2 bg-background text-foreground text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer hover:bg-accent/20 transition-colors';
const DIR_BTN = 'flex items-center px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors cursor-pointer';

const GROUP_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'scope', label: 'Scope' },
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
  { value: 'priority', label: 'Priority' },
];

const SORT_OPTIONS: readonly { value: SortBy; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'created_at', label: 'Created' },
  { value: 'updated_at', label: 'Updated' },
];

function ValuePicker<T extends string>({ value, options, onChange }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger type="button" className={`${VAL_SELECT} flex-1 min-w-0`}>
        <span className="truncate">{current?.label}</span>
        <ChevronDown className="w-3 h-3 shrink-0" strokeWidth={1.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => o.value !== value && onChange(o.value)}
            className={cn(o.value === value && 'text-primary')}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskListControls({ value, onChange }: Props) {
  function set(patch: Partial<ViewState>) {
    const next = { ...value, ...patch };
    saveViewState(next);
    onChange(next);
  }

  return (
    <div className="flex flex-row gap-2">

      {/* Group block */}
      <div className="flex flex-1 items-stretch border border-border overflow-hidden">
        <span className={KEY_CELL}>Group</span>
        <ValuePicker value={value.groupBy} options={GROUP_OPTIONS} onChange={(groupBy) => set({ groupBy })} />
        <button
          type="button"
          onClick={() => set({ groupDir: value.groupDir === 'asc' ? 'desc' : 'asc' })}
          title={value.groupDir === 'asc' ? 'Groups ascending' : 'Groups descending'}
          className={`${DIR_BTN} border-l border-border`}
        >
          {value.groupDir === 'asc'
            ? <ArrowUp className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            : <ArrowDown className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          }
        </button>
      </div>

      {/* Sort block */}
      <div className="flex flex-1 items-stretch border border-border overflow-hidden">
        <span className={KEY_CELL}>Sort</span>
        <ValuePicker value={value.sortBy} options={SORT_OPTIONS} onChange={(sortBy) => set({ sortBy })} />
        <button
          type="button"
          onClick={() => set({ sortDir: value.sortDir === 'asc' ? 'desc' : 'asc' })}
          title={value.sortDir === 'asc' ? 'Tasks ascending' : 'Tasks descending'}
          className={`${DIR_BTN} border-l border-border`}
        >
          {value.sortDir === 'asc'
            ? <ArrowUp className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            : <ArrowDown className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          }
        </button>
      </div>

    </div>
  );
}
