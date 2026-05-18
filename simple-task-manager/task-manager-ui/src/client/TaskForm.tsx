import { useState, useRef, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { TYPES, PRIORITIES, RELATIONS, STATUS_CLASSES, STATUS_LABELS } from './constants';
import { cn } from '@/lib/utils';
import type { Task, TaskRef, TaskType, TaskPriority, TaskStatus } from '@/types/task';

type InitialStatus = 'refinement' | 'todo';

type FormState = {
  title: string;
  type: TaskType;
  priority: TaskPriority;
  description: string;
  summary: string;
  scope: string;
  refs: TaskRef[];
  status: InitialStatus | undefined;
};

const EMPTY: FormState = { title: '', type: 'feature', priority: 'medium', description: '', summary: '', scope: '', refs: [], status: 'refinement' };

const INITIAL_STATUSES: InitialStatus[] = ['refinement', 'todo'];

export type TaskFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Task | null;
  allTasks: Task[];
  onSubmit: (form: FormState & { status: InitialStatus | undefined }) => void | Promise<void>;
  onDelete?: (id: number) => void | Promise<void>;
};

function deriveStatus(status: TaskStatus | undefined): InitialStatus | undefined {
  if (status === 'refinement' || status === 'todo') return status;
  return undefined;
}

function deriveForm(initial: Task | null): FormState {
  if (!initial) return EMPTY;
  return {
    title: initial.title,
    type: initial.type,
    priority: initial.priority,
    description: initial.description ?? '',
    summary: initial.summary ?? '',
    scope: initial.scope ?? '',
    refs: initial.refs ?? [],
    status: deriveStatus(initial.status),
  };
}

function formsEqual(a: FormState, b: FormState): boolean {
  return a.title === b.title &&
    a.type === b.type &&
    a.priority === b.priority &&
    a.description === b.description &&
    a.summary === b.summary &&
    a.scope === b.scope &&
    a.status === b.status &&
    a.refs.length === b.refs.length &&
    a.refs.every((r, i) => r.id === b.refs[i]?.id && r.relation === b.refs[i]?.relation);
}

export function TaskForm({ open, onOpenChange, initial, allTasks, onSubmit, onDelete }: TaskFormProps) {
  const [form, setForm] = useState<FormState>(() => deriveForm(initial));
  const [initialForm] = useState<FormState>(() => deriveForm(initial));
  const [refSearch, setRefSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeHighlight, setScopeHighlight] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDirty = !formsEqual(form, initialForm);

  // Scope suggestions are drawn from existing tasks only — no tool registry
  // in this standalone package.
  const scopeSuggestions = (() => {
    const set = new Set<string>();
    for (const t of allTasks) if (t.scope) set.add(t.scope);
    return [...set].sort();
  })();

  const filteredScopeSuggestions = scopeSuggestions.filter((s) =>
    s.toLowerCase().includes(form.scope.toLowerCase())
  );

  function pickScope(value: string) {
    setForm((f) => ({ ...f, scope: value }));
    setScopeOpen(false);
    setScopeHighlight(-1);
  }

  function onScopeKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!scopeOpen) {
        if (filteredScopeSuggestions.length > 0) {
          setScopeOpen(true);
          setScopeHighlight(0);
        }
        return;
      }
      if (scopeHighlight >= 0 && scopeHighlight < filteredScopeSuggestions.length) {
        const picked = filteredScopeSuggestions[scopeHighlight];
        if (picked !== undefined) pickScope(picked);
        return;
      }
      setScopeOpen(false);
      setScopeHighlight(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredScopeSuggestions.length === 0) return;
      if (!scopeOpen) {
        setScopeOpen(true);
        setScopeHighlight(0);
      } else {
        setScopeHighlight((h) => (h + 1) % filteredScopeSuggestions.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredScopeSuggestions.length === 0) return;
      if (!scopeOpen) {
        setScopeOpen(true);
        setScopeHighlight(filteredScopeSuggestions.length - 1);
      } else {
        setScopeHighlight((h) =>
          h <= 0 ? filteredScopeSuggestions.length - 1 : h - 1
        );
      }
      return;
    }
    if (e.key === 'Escape' && scopeOpen) {
      e.preventDefault();
      e.stopPropagation();
      setScopeOpen(false);
      setScopeHighlight(-1);
    }
  }

  function guardedClose(requestedOpen: boolean) {
    if (!requestedOpen && isDirty) return;
    onOpenChange(requestedOpen);
  }

  const set = <K extends keyof Omit<FormState, 'refs'>>(k: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value as FormState[K] }));

  function addRef(task: Task) {
    if (form.refs.some((r) => r.id === task.id)) return;
    setForm((f) => ({ ...f, refs: [...f.refs, { id: task.id, relation: 'relates to' }] }));
    setRefSearch('');
    setDropdownOpen(false);
  }

  function removeRef(id: number) {
    setForm((f) => ({ ...f, refs: f.refs.filter((r) => r.id !== id) }));
  }

  function setRefRelation(id: number, relation: string) {
    setForm((f) => ({
      ...f,
      refs: f.refs.map((r) => r.id === id ? { ...r, relation, nonCanonical: undefined } : r),
    }));
  }

  const selectedIds = new Set(form.refs.map((r) => r.id));
  const editingId = initial?.id;

  const candidates = allTasks.filter((t) =>
    t.id !== editingId &&
    t.status !== 'done' &&
    !selectedIds.has(t.id) &&
    (refSearch === '' ||
      `#${t.id}`.includes(refSearch) ||
      t.title.toLowerCase().includes(refSearch.toLowerCase()))
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSubmit(form);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={guardedClose}>
      <DialogContent
        className="bg-card border-border sm:max-w-[800px]"
        hideCloseButton
        onEscapeKeyDown={e => { if (isDirty) e.preventDefault(); }}
        onInteractOutside={e => { if (isDirty) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">
            {initial ? 'Edit Task' : 'New Task'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4 min-w-0">
          <input
            autoFocus
            required
            placeholder="Title"
            value={form.title}
            onChange={set('title')}
            className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full"
          />

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest text-muted-foreground uppercase">Type</span>
              <select
                value={form.type}
                onChange={set('type')}
                className="bg-background border border-border px-2 py-2 text-base text-foreground focus:outline-none focus:border-primary"
              >
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest text-muted-foreground uppercase">Priority</span>
              <select
                value={form.priority}
                onChange={set('priority')}
                className="bg-background border border-border px-2 py-2 text-base text-foreground focus:outline-none focus:border-primary"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-xs tracking-widest text-muted-foreground uppercase">Scope</span>
              <div className="relative">
                <input
                  value={form.scope}
                  onChange={(e) => { set('scope')(e); setScopeHighlight(-1); }}
                  onFocus={() => setScopeOpen(true)}
                  onClick={() => setScopeOpen(true)}
                  onBlur={() => { scopeCloseTimer.current = setTimeout(() => { setScopeOpen(false); setScopeHighlight(-1); }, 150); }}
                  onKeyDown={onScopeKeyDown}
                  placeholder="(none)"
                  className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full"
                />
                {scopeOpen && filteredScopeSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 border border-border border-t-0 bg-card z-10 max-h-48 overflow-y-auto">
                    {filteredScopeSuggestions.map((s, i) => (
                      <button
                        key={s}
                        type="button"
                        onMouseDown={() => { if (scopeCloseTimer.current) clearTimeout(scopeCloseTimer.current); }}
                        onMouseEnter={() => setScopeHighlight(i)}
                        onClick={() => pickScope(s)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors min-w-0',
                          i === scopeHighlight ? 'bg-accent/30' : 'hover:bg-accent/20',
                        )}
                      >
                        <span className="text-sm text-foreground truncate">{s}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-widest text-muted-foreground uppercase">Description</span>
            <textarea
              rows={12}
              value={form.description}
              onChange={set('description')}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Context, acceptance criteria, notes…"
              className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-y max-h-[40vh]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-widest text-muted-foreground uppercase">Summary</span>
            <textarea
              rows={3}
              value={form.summary}
              onChange={set('summary')}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="2–3 line gist: what it does, key decision, outcome…"
              className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-y"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs tracking-widest text-muted-foreground uppercase">References</span>

            {form.refs.length > 0 && (
              <div className="flex flex-col border border-border divide-y divide-border">
                {form.refs.map((ref) => {
                  const linked = allTasks.find((t) => t.id === ref.id);
                  return (
                    <div key={ref.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">#{ref.id}</span>
                      <span className="text-sm text-foreground flex-1 truncate min-w-0">
                        {linked?.title ?? '—'}
                      </span>
                      <select
                        value={ref.relation}
                        onChange={(e) => setRefRelation(ref.id, e.target.value)}
                        className="text-xs bg-background border border-border px-2 py-1 text-muted-foreground focus:outline-none focus:border-primary shrink-0"
                      >
                        {ref.nonCanonical && (
                          <option value={ref.relation} disabled>{ref.relation} (custom)</option>
                        )}
                        {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeRef(ref.id)}
                        className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0 text-sm leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="relative">
              <input
                value={refSearch}
                onChange={(e) => { setRefSearch(e.target.value); setDropdownOpen(true); }}
                onFocus={() => setDropdownOpen(true)}
                onBlur={() => { closeTimer.current = setTimeout(() => setDropdownOpen(false), 150); }}
                placeholder="Search tasks to link…"
                className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full"
              />
              {dropdownOpen && candidates.length > 0 && (
                <div className="absolute top-full left-0 right-0 border border-border border-t-0 bg-card z-10 max-h-48 overflow-y-auto">
                  {candidates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onMouseDown={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
                      onClick={() => addRef(t)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/20 transition-colors min-w-0"
                    >
                      <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">#{t.id}</span>
                      <span className="text-sm text-foreground truncate min-w-0 flex-1">{t.title}</span>
                      <span className="text-xs text-muted-foreground/50 shrink-0 ml-auto">{t.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {form.status !== undefined && (
              <div className="flex w-full border border-border divide-x divide-border sm:w-auto sm:mr-auto">
                {INITIAL_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, status: s }))}
                    className={cn(
                      'flex-1 text-xs tracking-widest px-3 py-2 transition-colors',
                      s === form.status
                        ? STATUS_CLASSES[s] + ' bg-accent/30'
                        : 'text-muted-foreground/40 hover:text-muted-foreground',
                    )}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-row gap-2 w-full sm:w-auto">
              {initial && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  onClick={() => {
                    if (window.confirm(`Delete task #${initial.id} "${initial.title}"?`)) {
                      onDelete(initial.id);
                      onOpenChange(false);
                    }
                  }}
                >
                  Delete
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" size="sm" className="flex-1 sm:flex-none" disabled={!form.title.trim()}>
                {initial ? 'Save' : 'Add Task'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
