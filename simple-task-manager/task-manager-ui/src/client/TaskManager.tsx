import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskListControls, loadViewState } from '@/components/TaskListControls';
import { cn } from '@/lib/utils';
import { groupTasks, nestEpicChildren, countOwnTasks, epicProgress, filterByProject, pickProject, projectFromPath, projectPath } from '@/lib/taskView';
import type { ViewState } from '@/lib/taskView';
import { useTasks } from './useTasks';
import { TaskCard } from './TaskCard';
import { TaskForm, type TaskPrefill } from './TaskForm';
import { ProjectDialog } from './ProjectDialog';
import { ProjectSwitcher } from './ProjectSwitcher';
import { isCollapsed } from './collapseState';
import { useRefNavigation } from './useRefNavigation';
import type { Task, TaskStatus, TaskType } from '@/types/task';

const COLLAPSE_KEY = 'task-manager:collapse';
const PROJECT_KEY = 'task-manager:project';

function loadProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

function saveProject(name: string): void {
  try {
    localStorage.setItem(PROJECT_KEY, name);
  } catch { /* storage unavailable — selection just isn't remembered */ }
}

type Tab = 'active' | 'done';

// Tree rail: each child draws its own segment (bridging the gap-2 above it) plus a
// tick to its title row; the last segment stops at its tick.
// Server messages worth showing verbatim: bad input, and the notice that the
// DB was migrated past this build.
function failureReason(err: unknown): string {
  return err instanceof Error && /^(Validation failed|DB was migrated)/.test(err.message) ? ` ${err.message}` : '';
}

const EPIC_RAIL = 'relative ml-2 pl-5 before:absolute before:left-0 before:-top-2 before:bottom-0 before:border-l before:border-primary/40 after:absolute after:left-0 after:top-6 after:w-4 after:border-t after:border-primary/40 last:before:bottom-auto last:before:h-8';

export default function TaskManager() {
  const { data, loading, error, add, update, remove, createProject, updateProject } = useTasks();
  const [tab, setTab] = useState<Tab>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState<'new' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [prefill, setPrefill] = useState<TaskPrefill | undefined>(undefined);
  const [view, setView] = useState<ViewState>(loadViewState);
  const [rememberedProject, setRememberedProject] = useState<string | null>(() => projectFromPath(window.location.pathname) ?? loadProject());

  const { active: allActive, done: allDone, projects } = data;
  const project = pickProject(projects.map((p) => p.id), rememberedProject);
  const currentProject = projects.find((p) => p.id === project);
  const active = project === null ? [] : filterByProject(allActive, project);
  const done = project === null ? [] : filterByProject(allDone, project);

  const selectProject = useCallback((id: string) => {
    setRememberedProject(id);
    saveProject(id);
    if (window.location.pathname !== projectPath(id)) window.history.pushState(null, '', projectPath(id));
  }, []);

  // Rewrite /, a miscased or an unknown id to the shown project's path,
  // without adding a history entry.
  useEffect(() => {
    if (project === null) return;
    saveProject(project);
    if (window.location.pathname !== projectPath(project)) window.history.replaceState(null, '', projectPath(project));
  }, [project]);

  useEffect(() => {
    const onPop = () => setRememberedProject(projectFromPath(window.location.pathname) ?? loadProject());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { navigateToRef, highlightedId, collapseVersion, toggleCollapse } =
    useRefNavigation(allActive, allDone, tab, setTab, view.groupBy, view.sortBy, view.sortDir, project, selectProject);

  void collapseVersion;

  const navigateToRefRef = useRef(navigateToRef);
  useEffect(() => { navigateToRefRef.current = navigateToRef; }, [navigateToRef]);

  async function handleStatus(id: number, status: TaskStatus) {
    try {
      await update(id, { status });
    } catch (err) {
      console.error('[task-ui] status update failed', { id, status, error: err });
      toast.error(`Failed to update status of #${id}.${failureReason(err)}`);
    }
  }

  async function handleDelete(id: number): Promise<boolean> {
    try {
      await remove(id);
      return true;
    } catch (err) {
      console.error('[task-ui] delete failed', { id, error: err });
      toast.error(`Failed to delete #${id}.${failureReason(err)}`);
      return false;
    }
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormOpen(true);
  }

  function openAdd(next?: TaskPrefill) {
    setEditing(null);
    setPrefill(next);
    setFormOpen(true);
  }

  function openAddChild(epic: Task) {
    openAdd({ project: epic.project, parentId: epic.id, scope: epic.scope ?? '' });
  }

  async function handleEditProject(settings: { name: string; trackPrs: boolean }): Promise<boolean> {
    if (!currentProject) return false;
    try {
      await updateProject(currentProject.id, settings);
      return true;
    } catch (err) {
      toast.error(`Failed to save project.${failureReason(err)}`);
      return false;
    }
  }

  async function handleCreateProject({ name }: { name: string }): Promise<boolean> {
    try {
      selectProject(await createProject(name));
      return true;
    } catch (err) {
      toast.error(`Failed to create project.${failureReason(err)}`);
      return false;
    }
  }

  async function handleFormSubmit(form: { project: string; title: string; type: TaskType; priority: Task['priority']; description: string; summary: string; scope: string; externalId: string; parentId: number | null; refs: import('@/types/task').TaskRef[]; status?: 'refinement' | 'plan' | 'todo' }): Promise<boolean> {
    const scope = form.scope || undefined;
    const refs = form.refs.length ? form.refs : undefined;
    try {
      if (editing) {
        await update(editing.id, {
          project: form.project,
          title: form.title,
          type: form.type,
          priority: form.priority,
          description: form.description,
          summary: form.summary || null,
          scope: scope ?? null,
          externalId: form.externalId || null,
          parentId: form.parentId,
          refs: form.refs.length ? form.refs : null,
          ...(form.status !== undefined && { status: form.status }),
        });
      } else {
        const newId = await add({ project: form.project, title: form.title, type: form.type, priority: form.priority, description: form.description, summary: form.summary || undefined, scope, externalId: form.externalId || undefined, ...(form.parentId !== null && { parentId: form.parentId }), refs, status: form.status ?? 'refinement' });
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
      toast.error((editing ? `Failed to save #${editing.id}.` : 'Failed to add task.') + failureReason(err));
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
    } else {
      toast.dismiss('tasks-fetch-error');
    }
  }, [error]);

  // Each tab nests over the other: done children under an open epic in Active; in Done, an open
  // epic with a done child is pulled in as a container with all its children.
  const own = tab === 'active' ? active : done;
  const tree = nestEpicChildren(own, tab === 'active' ? done : active, view.sortBy, view.sortDir);
  const ownIds = new Set(own.map((t) => t.id));
  const grouped = groupTasks(tree.roots, view.groupBy, view.groupDir, tree.anchors);

  const tabs: Tab[] = ['active', 'done'];
  const counts: Record<Tab, number> = { active: active.length, done: done.length };

  const progress = epicProgress([...allActive, ...allDone]);
  const refTargets = new Map([...allActive, ...allDone].map((t) => [t.id, { title: t.title, status: t.status }]));

  function renderCards(roots: Task[]) {
    return roots.map((task) => {
      const kids = tree.childrenByEpic.get(task.id);
      const collapseKey = `epic:${task.id}`;
      const collapsed = kids !== undefined && isCollapsed(localStorage, COLLAPSE_KEY, collapseKey);
      return (
        <div key={task.id} className="flex flex-col gap-2">
          <TaskCard
            task={task}
            tab={tab}
            onStatus={handleStatus}
            onEdit={openEdit}
            onAddChild={openAddChild}
            onRefClick={navigateToRef}
            refTargets={refTargets}
            highlighted={highlightedId === task.id}
            progress={task.type === 'epic' ? progress.get(task.id) : undefined}
            collapsed={collapsed}
            onToggleCollapse={kids ? () => toggleCollapse(collapseKey) : undefined}
            sticky={kids !== undefined && !collapsed}
          />
          {kids && !collapsed && kids.map((child) => (
            <div key={child.id} className={EPIC_RAIL}>
              <TaskCard
                task={child}
                tab={tab}
                onStatus={handleStatus}
                onEdit={openEdit}
                onRefClick={navigateToRef}
                refTargets={refTargets}
                highlighted={highlightedId === child.id}
                nested
              />
            </div>
          ))}
        </div>
      );
    });
  }

  function renderTaskList(groups: ReturnType<typeof groupTasks>, noTasksMsg: string) {
    if (loading) {
      return <p className="text-muted-foreground text-base">loading…</p>;
    }
    const tasks = groups.flatMap((g) => g.tasks);
    if (tasks.length === 0) {
      return <p className="text-muted-foreground text-base">{noTasksMsg}</p>;
    }

    if (view.groupBy === 'none') {
      return (
        <div className="flex flex-col gap-2">
          {renderCards(tasks)}
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
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() => toggleCollapse(collapseKey)}
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer hover:bg-accent/20 rounded -ml-2 px-2 py-1 transition-colors"
                >
                  {collapsed
                    ? <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                    : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform" strokeWidth={1.5} />
                  }
                  <span className="text-xs tracking-widest text-muted-foreground uppercase">
                    {label}
                  </span>
                  <span className="text-2xs tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
                    {countOwnTasks(sectionTasks, tree.childrenByEpic, ownIds)}
                  </span>
                  <div className="tick-rule flex-1" />
                </button>
                {/* Sections are never empty; the no-scope one yields ''. */}
                {view.groupBy === 'scope' && tab === 'active' && project !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Add task to ${label}`}
                    title={`Add task to ${label}`}
                    onClick={() => openAdd({ project, scope: sectionTasks[0]?.scope ?? '' })}
                  >
                    New task
                  </Button>
                )}
              </div>
              {!collapsed && (
                <div hidden={collapsed} className="flex flex-col gap-2">
                  {renderCards(sectionTasks)}
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
      <ProjectSwitcher
        projects={projects}
        current={project}
        onSelect={selectProject}
        onNewProject={() => setProjectDialog('new')}
        onEditProject={() => setProjectDialog('edit')}
      />

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
                {loading ? '…' : counts[t]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setProjectDialog('edit')} disabled={!currentProject}>Edit project</Button>
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setProjectDialog('new')}>New project</Button>
          <Button size="sm" variant="outline" onClick={() => openAdd()} disabled={project === null}>New task</Button>
        </div>
      </div>

      <TaskListControls value={view} onChange={setView} />

      {renderTaskList(grouped, tab === 'active' ? 'No active tasks. Add one to get started.' : 'No done tasks yet.')}

      <TaskForm
        key={`${String(formOpen)}:${editing?.id ?? 'new'}:${JSON.stringify(prefill ?? null)}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        prefill={prefill}
        allTasks={[...allActive, ...allDone]}
        projects={projects}
        project={project ?? ''}
        onSubmit={handleFormSubmit}
        onDelete={handleDelete}
      />

      <ProjectDialog
        key={projectDialog ?? 'closed'}
        open={projectDialog !== null}
        onOpenChange={(open) => { if (!open) setProjectDialog(null); }}
        initial={projectDialog === 'edit' ? currentProject : undefined}
        onSubmit={projectDialog === 'edit' ? handleEditProject : handleCreateProject}
      />
    </div>
  );
}
