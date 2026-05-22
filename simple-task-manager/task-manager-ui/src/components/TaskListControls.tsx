import { ArrowUp, ArrowDown } from 'lucide-react';
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
const VAL_SELECT = 'px-3 py-2 bg-background text-foreground text-xs focus:outline-none cursor-pointer hover:bg-accent/20 transition-colors';
const DIR_BTN = 'flex items-center px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors cursor-pointer';

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
        <select
          className={`${VAL_SELECT} flex-1 min-w-0`}
          value={value.groupBy}
          onChange={(e) => set({ groupBy: e.target.value as GroupBy })}
        >
          <option value="none">—</option>
          <option value="scope">Scope</option>
          <option value="status">Status</option>
          <option value="type">Type</option>
          <option value="priority">Priority</option>
        </select>
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
        <select
          className={`${VAL_SELECT} flex-1 min-w-0`}
          value={value.sortBy}
          onChange={(e) => set({ sortBy: e.target.value as SortBy })}
        >
          <option value="priority">Priority</option>
          <option value="status">Status</option>
          <option value="created_at">Created</option>
          <option value="updated_at">Updated</option>
        </select>
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
