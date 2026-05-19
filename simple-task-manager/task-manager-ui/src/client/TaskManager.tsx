import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskListControls, loadViewState } from '@/components/TaskListControls';
import { cn } from '@/lib/utils';
import { sortTasks, groupTasks } from '@/lib/taskView';
import type { ViewState } from '@/lib/taskView';
import { useTasks } from './useTasks';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';
import { isCollapsed } from './collapseState';
import { useRefNavigation } from './useRefNavigation';
import type { Task, TaskStatus, TaskType } from '@/types/task';

const COLLAPSE_KEY = 'task-manager:collapse';

type Tab = 'active' | 'done';

export default function TaskManager() {
  const { data, error, add, update, remove } = useTasks();
  const [tab, setTab] = useState<Tab>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [view, setView] = useState<ViewState>(loadViewState);

  const { active, done } = data;

  const { navigateToRef, highlightedId, collapseVersion, toggleCollapse } =
    useRefNavigation(active, done, tab, setTab, view.groupBy);

  void collapseVersion;

  const navigateToRefRef = useRef(navigateToRef);
  useEffect(() => { navigateToRefRef.current = navigateToRef; }, [navigateToRef]);

  async function handleStatus(id: number, status: TaskStatus) {
    try {
      await update(id, { status });
    } catch (err) {
      console.error('[task-ui] status update failed', { id, status, error: err });
      toast.error(`Failed to update status of #${id}.`);
    }
  }

  async function handleDelete(id: number): Promise<boolean> {
    try {
      await remove(id);
      return true;
    } catch (err) {
      console.error('[task-ui] delete failed', { id, error: err });
      toast.error(`Failed to delete #${id}.`);
      return false;
    }
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormOpen(true);
  }

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  async function handleFormSubmit(form: { title: string; type: TaskType; priority: Task['priority']; description: string; summary: string; scope: string; refs: import('@/types/task').TaskRef[]; status?: 'refinement' | 'plan' | 'todo' }): Promise<boolean> {
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
      return true;
    } catch (err) {
      // Keep the payload small — task descriptions can contain sensitive
      // text users wouldn't expect dumped to devtools logs.
      console.error('[task-ui] save failed', {
        editingId: editing?.id ?? null,
        titleLen: form.title.length,
        type: form.type,
        priority: form.priority,
        hasDescription: !!form.description,
        scope: form.scope || null,
        error: err,
      });
      toast.error(editing ? `Failed to save #${editing.id}.` : 'Failed to add task.');
      return false;
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

  const sortedActive = sortTasks(active, view.sortBy, view.sortDir);
  const sortedDone   = sortTasks(done,   view.sortBy, view.sortDir);
  const groupedActive = groupTasks(sortedActive, view.groupBy, view.groupDir);
  const groupedDone   = groupTasks(sortedDone,   view.groupBy, view.groupDir);

  const tabs: Tab[] = ['active', 'done'];
  const counts: Record<Tab, number> = { active: active.length, done: done.length };

  function renderTaskList(groups: ReturnType<typeof groupTasks>, noTasksMsg: string, showReopen: boolean) {
    const tasks = groups.flatMap((g) => g.tasks);
    if (tasks.length === 0) {
      return <p className="text-muted-foreground text-base">{noTasksMsg}</p>;
    }

    if (view.groupBy === 'none') {
      return (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onStatus={handleStatus}
              onEdit={openEdit}
              onRefClick={navigateToRef}
              highlighted={highlightedId === task.id}
              showReopen={showReopen}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-8">
        {groups.map(({ label, value, tasks: sectionTasks }) => {
          const collapseKey = `${view.groupBy}:${value}`;
          const collapsed = isCollapsed(localStorage, COLLAPSE_KEY, collapseKey);
          return (
            <section key={collapseKey}>
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => toggleCollapse(collapseKey)}
                className="flex items-center gap-3 mb-3 w-full cursor-pointer hover:bg-accent/20 rounded -mx-2 px-2 py-1 transition-colors"
              >
                {collapsed
                  ? <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                  : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                }
                <span className="text-xs tracking-widest text-muted-foreground uppercase">
                  {label}
                </span>
                <span className="text-2xs tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
                  {sectionTasks.length}
                </span>
                <div className="tick-rule flex-1" />
              </button>
              {!collapsed && (
                <div hidden={collapsed} className="flex flex-col gap-2">
                  {sectionTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onStatus={handleStatus}
                      onEdit={openEdit}
                      onRefClick={navigateToRef}
                      highlighted={highlightedId === task.id}
                      showReopen={showReopen}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex items-center gap-2 px-5 py-2 tracking-widest uppercase transition-colors border-b-2 -mb-px',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-xs">{t}</span>
              <span className="text-2xs tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
                {counts[t]}
              </span>
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openAdd}>+ New</Button>
      </div>

      <TaskListControls value={view} onChange={setView} />

      {tab === 'active' && renderTaskList(groupedActive, 'No active tasks. Add one to get started.', false)}
      {tab === 'done'   && renderTaskList(groupedDone,   'No done tasks yet.', true)}

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
