import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToolHeader } from '@/components/ToolHeader';
import { cn } from '@/lib/utils';
import { useTasks } from './useTasks';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';
import { isCollapsed } from './collapseState';
import { groupTasksByScope } from './groupTasksByScope';
import { useRefNavigation } from './useRefNavigation';
import type { Task, TaskStatus, TaskType } from '@/types/task';

const STORAGE_KEY_ACTIVE = 'task-manager:collapse:active';
const STORAGE_KEY_DONE = 'task-manager:collapse:done';
const STORAGE_KEYS = { active: STORAGE_KEY_ACTIVE, done: STORAGE_KEY_DONE };

type Tab = 'active' | 'done';

export default function TaskManager() {
  const { data, error, add, update, remove } = useTasks();
  const [tab, setTab] = useState<Tab>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const { active, done } = data;

  const { navigateToRef, highlightedId, collapseVersion, toggleCollapse } =
    useRefNavigation(active, done, tab, setTab, STORAGE_KEYS);

  void collapseVersion;

  const navigateToRefRef = useRef(navigateToRef);
  useEffect(() => { navigateToRefRef.current = navigateToRef; }, [navigateToRef]);

  async function handleStatus(id: number, status: TaskStatus) {
    try { await update(id, { status }); }
    catch { toast.error('Status update failed'); }
  }

  async function handleDelete(id: number) {
    try { await remove(id); }
    catch { toast.error('Delete failed'); }
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormOpen(true);
  }

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  async function handleFormSubmit(form: { title: string; type: TaskType; priority: Task['priority']; description: string; summary: string; scope: string; refs: import('@/types/task').TaskRef[]; status?: 'refinement' | 'todo' }) {
    const scope = form.scope || undefined;
    const refs = form.refs.length ? form.refs : undefined;
    try {
      if (editing) {
        await update(editing.id, {
          title: form.title,
          type: form.type,
          priority: form.priority,
          description: form.description,
          summary: form.summary || null,
          scope: scope ?? null,
          refs: form.refs.length ? form.refs : null,
          ...(form.status !== undefined && { status: form.status }),
        });
      } else {
        const newId = await add({ title: form.title, type: form.type, priority: form.priority, description: form.description, summary: form.summary || undefined, scope, refs, status: form.status ?? 'refinement' });
        const toastId = `task-added-${newId}`;
        toast.success(
          <button
            className="w-full text-left cursor-pointer"
            onClick={() => { navigateToRefRef.current(newId); toast.dismiss(toastId); }}
          >
            #{newId} added
          </button>,
          { id: toastId },
        );
      }
    } catch {
      toast.error('Save failed');
    }
  }

  useEffect(() => {
    if (error) {
      toast.error(`Failed to load tasks: ${error.message}`, {
        duration: Infinity,
        id: 'tasks-fetch-error',
        description: 'Is the server running?',
      });
    }
  }, [error]);

  const groupedActive = groupTasksByScope(active, 'active');
  const groupedDone = groupTasksByScope(done, 'done');

  const tabs: Tab[] = ['active', 'done'];

  return (
    <div className="flex flex-col gap-7">
      <ToolHeader
        title="Claude Task Manager"
        description="Browser UI for the simple-task-manager MCP. Edits live-sync via SQLite."
        status={`Active ${active.length} · Done ${done.length}`}
        actions={
          <Button size="sm" onClick={openAdd}>+ New</Button>
        }
      />

      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-5 py-2 text-xs tracking-widest uppercase transition-colors border-b-2 -mb-px',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'active' && (
        groupedActive.length === 0 ? (
          <p className="text-muted-foreground text-base">No active tasks. Add one to get started.</p>
        ) : (
          <div className="flex flex-col gap-8">
            {groupedActive.map(({ scope, tasks }) => {
              const collapsed = isCollapsed(localStorage, STORAGE_KEY_ACTIVE, scope);
              return (
                <section key={scope}>
                  <button
                    type="button"
                    onClick={() => toggleCollapse(STORAGE_KEY_ACTIVE, scope)}
                    className="flex items-center gap-3 mb-3 w-full cursor-pointer hover:bg-accent/20 rounded -mx-2 px-2 py-1 transition-colors"
                  >
                    {collapsed
                      ? <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                      : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                    }
                    <span className="text-xs tracking-widest text-muted-foreground uppercase">
                      {scope}
                    </span>
                    <span className="text-xs tracking-widest uppercase border border-border px-2 py-1 text-muted-foreground">
                      {tasks.length}
                    </span>
                    <div className="tick-rule flex-1" />
                  </button>
                  {!collapsed && (
                    <div className="flex flex-col gap-2">
                      {tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatus={handleStatus}
                          onEdit={openEdit}
                          onRefClick={navigateToRef}
                          highlighted={highlightedId === task.id}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )
      )}

      {tab === 'done' && (
        groupedDone.length === 0 ? (
          <p className="text-muted-foreground text-base">No done tasks yet.</p>
        ) : (
          <div className="flex flex-col gap-8">
            {groupedDone.map(({ scope, tasks }) => {
              const collapsed = isCollapsed(localStorage, STORAGE_KEY_DONE, scope);
              return (
                <section key={scope}>
                  <button
                    type="button"
                    onClick={() => toggleCollapse(STORAGE_KEY_DONE, scope)}
                    className="flex items-center gap-3 mb-3 w-full cursor-pointer hover:bg-accent/20 rounded -mx-2 px-2 py-1 transition-colors"
                  >
                    {collapsed
                      ? <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                      : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                    }
                    <span className="text-xs tracking-widest text-muted-foreground uppercase">
                      {scope}
                    </span>
                    <span className="text-xs tracking-widest uppercase border border-border px-2 py-1 text-muted-foreground">
                      {tasks.length}
                    </span>
                    <div className="tick-rule flex-1" />
                  </button>
                  {!collapsed && (
                    <div className="flex flex-col gap-2">
                      {tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatus={handleStatus}
                          onEdit={openEdit}
                          onRefClick={navigateToRef}
                          highlighted={highlightedId === task.id}
                          showReopen
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )
      )}

      <TaskForm
        key={`${String(formOpen)}:${editing?.id ?? 'new'}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        allTasks={[...active, ...done]}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
      />

    </div>
  );
}
