import { useEffect, useState, useRef, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { TYPES, PRIORITIES, RELATIONS } from './constants';
import { StatusPicker } from './StatusPicker';
import { cn } from '@/lib/utils';
import { TaskPicker } from './TaskPicker';
import { filterByProject } from '@/lib/taskView';
import type { Task, TaskRef, TaskType, TaskPriority, TaskStatus } from '@/types/task';

type InitialStatus = 'refinement' | 'plan' | 'todo';

type FormState = {
  project: string;
  title: string;
  type: TaskType;
  priority: TaskPriority;
  description: string;
  summary: string;
  scope: string;
  externalId: string;
  parentId: number | null;
  refs: TaskRef[];
  status: InitialStatus | undefined;
};

const EMPTY: Omit<FormState, 'project'> = { title: '', type: 'feature', priority: 'medium', description: '', summary: '', scope: '', externalId: '', parentId: null, refs: [], status: 'refinement' };

const INITIAL_STATUSES: InitialStatus[] = ['refinement', 'plan', 'todo'];

// New-task defaults from a quick-add button; scope must already be the epic's when parentId is set.
export type TaskPrefill = { project?: string; scope?: string; parentId?: number };

export type TaskFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Task | null;
  prefill?: TaskPrefill;
  allTasks: Task[];
  projects: string[];
  // Selected project; new tasks default to it.
  project: string;
  onSubmit: (form: FormState & { status: InitialStatus | undefined }) => Promise<boolean>;
  onDelete?: (id: number) => Promise<boolean>;
};

function deriveStatus(status: TaskStatus | undefined): InitialStatus | undefined {
  if (status === 'refinement' || status === 'plan' || status === 'todo') return status;
  return undefined;
}

function deriveForm(initial: Task | null, project: string, prefill?: TaskPrefill): FormState {
  if (!initial) {
    return {
      ...EMPTY,
      project: prefill?.project ?? project,
      scope: prefill?.scope ?? '',
      parentId: prefill?.parentId ?? null,
    };
  }
  return {
    project: initial.project,
    title: initial.title,
    type: initial.type,
    priority: initial.priority,
    description: initial.description ?? '',
    summary: initial.summary ?? '',
    scope: initial.scope ?? '',
    externalId: initial.externalId ?? '',
    parentId: initial.parentId ?? null,
    refs: initial.refs ?? [],
    status: deriveStatus(initial.status),
  };
}

function formsEqual(a: FormState, b: FormState): boolean {
  return a.project === b.project &&
    a.title === b.title &&
    a.type === b.type &&
    a.priority === b.priority &&
    a.description === b.description &&
    a.summary === b.summary &&
    a.scope === b.scope &&
    a.externalId === b.externalId &&
    a.parentId === b.parentId &&
    a.status === b.status &&
    a.refs.length === b.refs.length &&
    a.refs.every((r, i) => r.id === b.refs[i]?.id && r.relation === b.refs[i]?.relation);
}

export function TaskForm({ open, onOpenChange, initial, prefill, allTasks, projects, project, onSubmit, onDelete }: TaskFormProps) {
  const [form, setForm] = useState<FormState>(() => deriveForm(initial, project, prefill));
  const [initialForm] = useState<FormState>(() => deriveForm(initial, project, prefill));
  const [epicCleared, setEpicCleared] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeHighlight, setScopeHighlight] = useState(-1);
  const [scopePicked, setScopePicked] = useState<boolean>(() => (initial?.scope ?? prefill?.scope ?? '') !== '');
  const scopeCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeInputRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Move focus to the title input after Radix finishes its own focus
  // management on open. Without the rAF the dialog's focus-trap can
  // pull focus back to the DialogContent wrapper.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  function tryClose() {
    if (!isDirty || window.confirm('Discard unsaved changes?')) {
      onOpenChange(false);
    }
  }

  function clearScope() {
    setForm((f) => ({ ...f, scope: '' }));
    setScopePicked(false);
    setScopeOpen(false);
    setScopeHighlight(-1);
    scopeInputRef.current?.focus();
  }

  const isDirty = !formsEqual(form, initialForm);

  // Scope suggestions are drawn from existing tasks of the form's project only —
  // no tool registry in this standalone package.
  const scopeSuggestions = (() => {
    const set = new Set<string>();
    for (const t of filterByProject(allTasks, form.project)) if (t.scope) set.add(t.scope);
    return [...set].sort();
  })();

  const filteredScopeSuggestions = scopeSuggestions.filter((s) =>
    s.toLowerCase().includes(form.scope.toLowerCase())
  );

  function pickScope(value: string) {
    setForm((f) => ({ ...f, scope: value }));
    setScopePicked(true);
    setScopeOpen(false);
    setScopeHighlight(-1);
  }

  function onScopeKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && scopePicked && form.scope !== '') {
      e.preventDefault();
      clearScope();
      return;
    }
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
    if (!requestedOpen) {
      tryClose();
      return;
    }
    onOpenChange(requestedOpen);
  }

  const set = <K extends keyof Omit<FormState, 'refs' | 'parentId'>>(k: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value as FormState[K] }));

  function addRef(task: Task) {
    setForm((f) => f.refs.some((r) => r.id === task.id) ? f : { ...f, refs: [...f.refs, { id: task.id, relation: 'relates to' }] });
  }

  function pickParent(epic: Task) {
    setForm((f) => ({ ...f, parentId: epic.id, scope: epic.scope ?? '' }));
    setScopePicked(epic.scope !== undefined);
    setScopeOpen(false);
  }

  // The store rejects a parent from another project, so drop it here instead.
  function changeProject(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setForm((f) => {
      const epic = f.parentId === null ? undefined : allTasks.find((t) => t.id === f.parentId);
      const keep = epic !== undefined && epic.project.toLowerCase() === next.toLowerCase();
      return { ...f, project: next, parentId: keep ? f.parentId : null };
    });
  }

  function clearParent() {
    setForm((f) => ({ ...f, parentId: null }));
    setEpicCleared(true);
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
  const epicCandidates = filterByProject(allTasks, form.project).filter((t) => t.type === 'epic' && t.id !== editingId && t.status !== 'done');
  const refCandidates = filterByProject(allTasks, form.project).filter((t) => t.id !== editingId && t.status !== 'done' && !selectedIds.has(t.id));
  const parent = form.parentId === null ? undefined : allTasks.find((t) => t.id === form.parentId);
  // The store forces a child's scope to its epic's, so the input only mirrors it.
  const scopeLocked = form.type !== 'epic' && form.parentId !== null;
  const scopeValue = scopeLocked && parent ? parent.scope ?? '' : form.scope;

  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onSubmit(form.type === 'epic' ? { ...form, parentId: null } : form);
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={guardedClose}>
      <DialogContent
        className="bg-card border-border sm:max-w-[800px] flex flex-col max-h-[calc(100dvh-2rem)]"
        hideCloseButton
        onEscapeKeyDown={(e) => {
          if (isDirty && !window.confirm('Discard unsaved changes?')) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          tryClose();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">
            {initial ? 'Edit Task' : 'New Task'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4 min-w-0 min-h-0">
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">
            {/* 5:1, but the ID column never drops below 9rem so "OPXPIQ-6532" isn't clipped. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[5fr_minmax(9rem,1fr)]">
              <input
                ref={titleRef}
                required
                placeholder="Title"
                value={form.title}
                onChange={set('title')}
                className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full"
              />
              <input
                placeholder="External ID"
                aria-label="External ID"
                value={form.externalId}
                onChange={set('externalId')}
                className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full min-w-0"
              />
            </div>

            <div className={cn('grid gap-3', projects.length > 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
              {projects.length > 1 && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs tracking-widest text-muted-foreground uppercase">Project</span>
                  <select
                    value={form.project}
                    onChange={changeProject}
                    className="bg-background border border-border px-2 h-9 text-base text-foreground focus:outline-none focus:border-primary min-w-0"
                  >
                    {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-xs tracking-widest text-muted-foreground uppercase">Type</span>
                <select
                  value={form.type}
                  onChange={set('type')}
                  className="bg-background border border-border px-2 h-9 text-base text-foreground focus:outline-none focus:border-primary"
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs tracking-widest text-muted-foreground uppercase">Priority</span>
                <select
                  value={form.priority}
                  onChange={set('priority')}
                  className="bg-background border border-border px-2 h-9 text-base text-foreground focus:outline-none focus:border-primary"
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-xs tracking-widest text-muted-foreground uppercase">Scope</span>
                <div className="relative">
                  <input
                    ref={scopeInputRef}
                    value={scopeValue}
                    disabled={scopeLocked}
                    title={scopeLocked ? 'Set by the parent epic' : undefined}
                    onChange={(e) => { set('scope')(e); setScopeHighlight(-1); setScopePicked(false); }}
                    onFocus={() => setScopeOpen(true)}
                    onClick={() => setScopeOpen(true)}
                    onBlur={() => { scopeCloseTimer.current = setTimeout(() => { setScopeOpen(false); setScopeHighlight(-1); }, 150); }}
                    onKeyDown={onScopeKeyDown}
                    placeholder="(none)"
                    className="bg-background border border-border pl-3 pr-8 h-9 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  {!scopeLocked && (form.scope === '' ? (
                    <ChevronDown
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label="Clear scope"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={clearScope}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  ))}
                  {!scopeLocked && scopeOpen && filteredScopeSuggestions.length > 0 && (
                    <div tabIndex={-1} className="absolute top-full left-0 right-0 border border-border border-t-0 bg-card z-10 max-h-48 overflow-y-auto">
                      {filteredScopeSuggestions.map((s, i) => (
                        <button
                          key={s}
                          type="button"
                          tabIndex={-1}
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

            {form.type !== 'epic' && (
              <div className="flex flex-col gap-1">
                <span className="text-xs tracking-widest text-muted-foreground uppercase">Parent epic</span>
                {form.parentId !== null ? (
                  <div className="flex items-center gap-2 px-3 h-9 border border-border">
                    <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">#{form.parentId}</span>
                    <span className="text-sm text-foreground flex-1 truncate min-w-0">{parent?.title ?? '—'}</span>
                    <button
                      type="button"
                      aria-label="Clear parent epic"
                      onClick={clearParent}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0 text-sm leading-none"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <TaskPicker
                    tasks={epicCandidates}
                    onPick={pickParent}
                    placeholder="Search epics…"
                    autoFocus={epicCleared}
                  />
                )}
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs tracking-widest text-muted-foreground uppercase">Description</span>
              <textarea
                rows={12}
                value={form.description}
                onChange={set('description')}
                onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
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
                onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
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

              <TaskPicker tasks={refCandidates} onPick={addRef} placeholder="Search tasks to link…" dropUpOnMobile />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {form.status !== undefined && (
              <StatusPicker
                value={form.status}
                options={INITIAL_STATUSES}
                onChange={(st) => setForm((f) => ({ ...f, status: st }))}
                className="mr-auto"
              />
            )}
            <div className="flex gap-2">
              {initial && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={submitting}
                  onClick={async () => {
                    if (!window.confirm(`Delete task #${initial.id} "${initial.title}"?`)) return;
                    setSubmitting(true);
                    try {
                      const ok = await onDelete(initial.id);
                      if (ok) onOpenChange(false);
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  Delete
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={tryClose} disabled={submitting}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!form.title.trim() || submitting}>
                {submitting ? 'Saving…' : (initial ? 'Save' : 'Add Task')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
