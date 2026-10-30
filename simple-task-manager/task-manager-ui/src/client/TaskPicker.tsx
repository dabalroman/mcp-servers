import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { matchesTaskQuery } from '@/lib/taskView';
import type { Task } from '@/types/task';

export type TaskPickerProps = {
  // Pickable tasks before the search query is applied.
  tasks: Task[];
  onPick: (task: Task) => void;
  placeholder: string;
  autoFocus?: boolean;
};

export function TaskPicker({ tasks, onPick, placeholder, autoFocus }: TaskPickerProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The parent-epic picker unmounts on pick, while the blur timer is still pending.
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const candidates = tasks.filter((t) => matchesTaskQuery(t, search));

  function pick(task: Task) {
    onPick(task);
    setSearch('');
    setOpen(false);
    setHighlight(-1);
  }

  function clearSearch() {
    setSearch('');
    setHighlight(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        if (candidates.length > 0) {
          setOpen(true);
          setHighlight(0);
        }
        return;
      }
      if (highlight >= 0 && highlight < candidates.length) {
        const picked = candidates[highlight];
        if (picked !== undefined) pick(picked);
        return;
      }
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (candidates.length === 0) return;
      if (!open) {
        setOpen(true);
        setHighlight(0);
      } else {
        setHighlight((h) => (h + 1) % candidates.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (candidates.length === 0) return;
      if (!open) {
        setOpen(true);
        setHighlight(candidates.length - 1);
      } else {
        setHighlight((h) => (h <= 0 ? candidates.length - 1 : h - 1));
      }
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setHighlight(-1);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); setHighlight(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { closeTimer.current = setTimeout(() => { setOpen(false); setHighlight(-1); }, 150); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="bg-background border border-border pl-3 pr-8 h-9 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full"
      />
      {search === '' ? (
        <ChevronDown
          className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          strokeWidth={1.5}
        />
      ) : (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearSearch}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>
      )}
      {open && candidates.length > 0 && (
        <div tabIndex={-1} className="absolute top-full left-0 right-0 border border-border border-t-0 bg-card z-10 max-h-48 overflow-y-auto">
          {candidates.map((t, i) => (
            <button
              key={t.id}
              type="button"
              tabIndex={-1}
              onMouseDown={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(t)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors min-w-0',
                i === highlight ? 'bg-accent/30' : 'hover:bg-accent/20',
              )}
            >
              <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">#{t.id}</span>
              <span className="text-sm text-foreground truncate min-w-0 flex-1">{t.title}</span>
              <span className="text-xs text-muted-foreground/50 shrink-0 ml-auto">{t.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
