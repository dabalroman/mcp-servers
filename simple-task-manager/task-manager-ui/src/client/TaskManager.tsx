import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskListControls, loadViewState } from '@/components/TaskListControls';
import { cn } from '@/lib/utils';
import { NO_SCOPE, groupTasks, nestEpicChildren, countOwnTasks, epicProgress, filterByProject, filterByRepo, activeRepoChoice, pickProject, projectFromPath, projectPath, settingsPath, isSettingsPath, defaultView, resolveCardViews } from '@/lib/taskView';
import type { CardView, CardViewEntry, ReorderOrder, ViewState } from '@/lib/taskView';
import { useTasks } from './useTasks';
import { TaskCard } from './TaskCard';
import { EpicChildren } from './EpicChildren';
import { TaskForm, type TaskPrefill } from './TaskForm';
import { ProjectDialog } from './ProjectDialog';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ProjectSettings } from './ProjectSettings';
import { useRepos } from './useRepos';
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

// Server messages worth showing verbatim: bad input, and the notice that the
// DB was migrated past this build.
function failureReason(err: unknown): string {
  return err instanceof Error && /^(Validation failed|DB was migrated)/.test(err.message) ? ` ${err.message}` : '';
}

export default function TaskManager() {
  const { data, loading, error, add, update, reorder, remove, createProject, updateProject } = useTasks();
  const [tab, setTab] = useState<Tab>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [prefill, setPrefill] = useState<TaskPrefill | undefined>(undefined);
  const [view, setView] = useState<ViewState>(loadViewState);
  const [cardViews, setCardViews] = useState<ReadonlyMap<number, CardViewEntry>>(() => new Map());
  const [rememberedProject, setRememberedProject] = useState<string | null>(() => projectFromPath(window.location.pathname) ?? loadProject());

  const [settingsOpen, setSettingsOpen] = useState(() => isSettingsPath(window.location.pathname));

  const { active: allActive, done: allDone, projects } = data;
  const project = pickProject(projects.map((p) => p.id), rememberedProject);
  const currentProject = projects.find((p) => p.id === project);
  const { repos } = useRepos(project, data);
  const repoIds = repos.map((r) => r.id);
  // Without repos there is no filter and no repo UI at all.
  const repoChoice = project === null ? undefined : activeRepoChoice(view.repos[project], repoIds);
  // Filtered as one list so an epic in one tab stays when only its child in the other matches.
  const visible = project === null ? [] : filterByRepo(filterByProject([...allActive, ...allDone], project), repoChoice);
  const visibleIds = new Set(visible.map((t) => t.id));
  const active = project === null ? [] : filterByProject(allActive, project).filter((t) => visibleIds.has(t.id));
  const done = project === null ? [] : filterByProject(allDone, project).filter((t) => visibleIds.has(t.id));

  const selectProject = useCallback((id: string) => {
    setRememberedProject(id);
    setSettingsOpen(false);
    saveProject(id);
    if (window.location.pathname !== projectPath(id)) window.history.pushState(null, '', projectPath(id));
  }, []);

  const openSettings = useCallback(() => {
    if (project === null) return;
    setSettingsOpen(true);
    window.history.pushState(null, '', settingsPath(project));
  }, [project]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (project !== null) window.history.pushState(null, '', projectPath(project));
  }, [project]);

  // Rewrite /, a miscased or an unknown id to the shown project's path (keeping /settings),
  // without adding a history entry.
  useEffect(() => {
    if (project === null) return;
    saveProject(project);
    const wanted = settingsOpen ? settingsPath(project) : projectPath(project);
    if (window.location.pathname !== wanted) window.history.replaceState(null, '', wanted);
  }, [project, settingsOpen]);

  useEffect(() => {
    const onPop = () => {
      setRememberedProject(projectFromPath(window.location.pathname) ?? loadProject());
      setSettingsOpen(isSettingsPath(window.location.pathname));
    };
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

  async function handleReorder(epicId: number, order: ReorderOrder): Promise<boolean> {
    try {
      await reorder(epicId, order);
      return true;
    } catch (err) {
      console.error('[task-ui] reorder failed', { epicId, order, error: err });
      toast.error(`Failed to reorder #${epicId}.${failureReason(err)}`);
      return false;
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

  async function handleEditProject(settings: { name: string; trackPrs: boolean; description: string }): Promise<boolean> {
    if (!currentProject) return false;
    try {
      await updateProject(currentProject.id, settings);
      return true;
    } catch (err) {
      toast.error(`Failed to save project.${failureReason(err)}`);
      return false;
    }
  }

  async function handleCreateProject({ name, description }: { name: string; description: string }): Promise<boolean> {
    try {
      selectProject(await createProject(name, description));
      return true;
    } catch (err) {
      toast.error(`Failed to create project.${failureReason(err)}`);
      return false;
    }
  }

  async function handleFormSubmit(form: { project: string; title: string; type: TaskType; priority: Task['priority']; description: string; summary: string; scope: string; repo: string; touches: string[]; externalId: string; parentId: number | null; refs: import('@/types/task').TaskRef[]; status?: 'refinement' | 'plan' | 'todo' }): Promise<boolean> {
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
          repo: form.repo || null,
          touches: form.touches.length ? form.touches : null,
          externalId: form.externalId || null,
          parentId: form.parentId,
          refs: form.refs.length ? form.refs : null,
          ...(form.status !== undefined && { status: form.status }),
        });
      } else {
        const newId = await add({ project: form.project, title: form.title, type: form.type, priority: form.priority, description: form.description, summary: form.summary || undefined, scope, ...(form.repo && { repo: form.repo }), ...(form.touches.length > 0 && { touches: form.touches }), externalId: form.externalId || undefined, ...(form.parentId !== null && { parentId: form.parentId }), refs, status: form.status ?? 'refinement' });
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

  // Resolved during render (not in an effect) so a status change never paints the stale view.
  const shown = tree.roots.flatMap((t) => [t, ...(tree.childrenByEpic.get(t.id) ?? [])]);
  const resolvedViews = resolveCardViews(cardViews, shown, tab);
  if (resolvedViews !== cardViews) setCardViews(resolvedViews);

  function cardViewProps(task: Task) {
    const entry = resolvedViews.get(task.id);
    return {
      view: entry?.view ?? defaultView(task.status, tab),
      onViewChange: (next: CardView) => setCardViews((m) => {
        const cur = m.get(task.id);
        return cur ? new Map(m).set(task.id, { ...cur, view: next }) : m;
      }),
    };
  }

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
            {...cardViewProps(task)}
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
          {kids && !collapsed && (
            <EpicChildren
              epicId={task.id}
              kids={kids}
              onReorder={handleReorder}
              renderCard={(child, dragHandle) => (
                <TaskCard
                  task={child}
                  {...cardViewProps(child)}
                  onStatus={handleStatus}
                  onEdit={openEdit}
                  onRefClick={navigateToRef}
                  refTargets={refTargets}
                  highlighted={highlightedId === child.id}
                  nested
                  dragHandle={dragHandle}
                />
              )}
            />
          )}
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
                {/* The section's own value: its first card may be an epic pulled in from the other tab. */}
                {view.groupBy === 'scope' && tab === 'active' && project !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Add task to ${label}`}
                    title={`Add task to ${label}`}
                    onClick={() => openAdd({ project, scope: value === NO_SCOPE ? '' : value })}
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
        onNewProject={() => setProjectDialog(true)}
        onSettings={openSettings}
      />

      {settingsOpen && currentProject ? (
        <ProjectSettings key={currentProject.id} project={currentProject} version={data} onSave={handleEditProject} onBack={closeSettings} />
      ) : (
        <>
          <div className="flex border-b border-border">
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
          </div>

          <TaskListControls value={view} repoFilter={repoIds.length > 0 && project !== null ? { project, repoIds } : undefined} onChange={setView}>
            <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={openSettings} disabled={!currentProject}>Settings</Button>
            <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setProjectDialog(true)}>New project</Button>
            <Button size="sm" variant="outline" onClick={() => openAdd()} disabled={project === null}>New task</Button>
          </TaskListControls>

          {renderTaskList(grouped, tab === 'active' ? 'No active tasks. Add one to get started.' : 'No done tasks yet.')}
        </>
      )}

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
        key={String(projectDialog)}
        open={projectDialog}
        onOpenChange={setProjectDialog}
        onSubmit={handleCreateProject}
      />
    </div>
  );
}
