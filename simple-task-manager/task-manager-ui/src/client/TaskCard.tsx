import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Check, ChevronDown, ChevronRight, ChevronUp, Equal, FileText, Rocket, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { TYPE_LABELS, PRIORITY_CLASSES, PR_STATUS_CLASSES, REF_STATUS_CLASSES, STATUS_CLASSES, STATUS_LABELS } from './constants';
import { StatusPicker } from './StatusPicker';
import { defaultView, nextView } from '@/lib/taskView';
import type { CardTab, CardView, EpicProgress } from '@/lib/taskView';
import type { Note, Task, TaskStatus } from '@/types/task';

const STATUSES: TaskStatus[] = ['refinement', 'plan', 'todo', 'in_progress', 'done'];

const VIEW_ICONS: Record<CardView, LucideIcon> = { compact: ChevronDown, collapsed: Equal, full: ChevronUp };
const VIEW_LABELS: Record<CardView, string> = { compact: 'Compact view', collapsed: 'Collapsed view', full: 'Full view' };

function formatSqliteUtc(ts: string): string {
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function NotesSection({ notes }: { notes: Note[] }) {
  return (
    <div className="flex flex-col gap-2 mt-2">
      <span className="text-xs tracking-widest uppercase text-muted-foreground">Notes</span>
      {notes.map((note) => (
        <div key={note.id} className="flex flex-col gap-1 border-l border-border pl-3">
          <span className="text-xs text-muted-foreground/60">
            {formatSqliteUtc(note.created_at)}
            {note.updated_at !== note.created_at && <span className="ml-2 italic">edited</span>}
          </span>
          <div className="text-sm text-muted-foreground leading-relaxed prose-task">
            <Markdown remarkPlugins={[remarkGfm]}>{note.body}</Markdown>
          </div>
        </div>
      ))}
    </div>
  );
}

export type TaskCardProps = {
  task: Task;
  tab: CardTab;
  onStatus: (id: number, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onAddChild?: (epic: Task) => void;
  onRefClick?: (id: number) => void;
  refTargets?: Map<number, { title: string; status: TaskStatus }>;
  highlighted?: boolean;
  showReopen?: boolean;
  progress?: EpicProgress;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  nested?: boolean;
  sticky?: boolean;
};

export function TaskCard({ task, tab, onStatus, onEdit, onAddChild, onRefClick, refTargets, highlighted = false, showReopen = false, progress, collapsed = false, onToggleCollapse, nested = false, sticky = false }: TaskCardProps) {
  const [viewState, setViewState] = useState(() => ({ status: task.status, view: defaultView(task.status, tab) }));
  let view = viewState.view;
  // Adjusted during render (not in an effect) so a status change never paints the stale view.
  if (viewState.status !== task.status) {
    view = defaultView(task.status, tab);
    setViewState({ status: task.status, view });
  }
  const setView = (v: CardView) => setViewState({ status: task.status, view: v });
  const next = nextView(view);
  const ViewIcon = VIEW_ICONS[view];
  const [planOpen, setPlanOpen] = useState(false);
  const hasSummary = Boolean(task.summary);
  const notes = task.notes ?? [];
  const noteCount = task.noteCount ?? notes.length;

  const externalIdClass = 'text-xs tracking-widest border border-border px-2 py-1 truncate text-muted-foreground';
  const notesPillClass = 'text-xs tracking-widest uppercase border border-border px-2 py-1 shrink-0 text-muted-foreground';
  const notesLabel = `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`;

  const prTags = task.prs?.map((pr) => (
    <a
      key={pr.url}
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${pr.status} — ${pr.url}`}
      className={cn(
        'inline-flex items-center gap-1 text-xs tracking-widest border px-2 py-1 shrink-0 hover:text-foreground transition-colors',
        PR_STATUS_CLASSES[pr.status],
      )}
    >
      PR #{pr.number}
      {pr.status === 'merged' && <Check className="w-3 h-3" strokeWidth={1.5} />}
      {pr.status === 'deployed' && <Rocket className="w-3 h-3" strokeWidth={1.5} />}
    </a>
  ));

  const copyIdCommand = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const cmd =
      task.status === 'refinement' ? `/tm:refine #${task.id}` :
      task.status === 'plan' ? `/plan #${task.id}` :
      task.status === 'todo' || task.status === 'in_progress' ? `/tm:implement #${task.id}` :
      `#${task.id}`;
    const successMsg =
      task.status === 'refinement' ? 'Copied — paste into Claude Code to refine' :
      task.status === 'plan' ? 'Copied — paste into Claude Code to plan' :
      task.status === 'todo' || task.status === 'in_progress' ? 'Copied — paste into Claude Code to implement' :
      `#${task.id} copied`;
    const fallback = (container: HTMLElement) => {
      const el = document.createElement('textarea');
      el.value = cmd;
      el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
      container.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand('copy'); toast.success(successMsg); }
      catch { toast.error('Copy failed'); }
      container.removeChild(el);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cmd).then(() => toast.success(successMsg)).catch(() => fallback(e.currentTarget));
    } else {
      fallback(e.currentTarget);
    }
  };

  const renderDescription = (clamped: boolean) => task.description ? (
    <div className={cn('text-sm text-muted-foreground leading-relaxed prose-task', clamped && 'line-clamp-3')}>
      <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
    </div>
  ) : (
    <span className="text-sm text-muted-foreground/40 italic">No description.</span>
  );

  return (
    <div
      data-task-id={task.id}
      className={cn(
        'border bg-card flex flex-col gap-0 transition-[border-color,box-shadow] duration-500 overflow-hidden',
        task.status === 'done' && 'opacity-60',
        // A full card can be taller than the viewport; don't pin it.
        sticky && view !== 'full' && 'sticky top-0 z-10',
        highlighted ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]' : 'border-border',
      )}
    >
      <div className={cn('flex flex-col gap-3 px-3 pt-3', view === 'compact' ? 'pb-3' : 'pb-2')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="flex items-stretch shrink-0">
              <button
                type="button"
                onClick={copyIdCommand}
                className={cn(
                  'text-xs tracking-widest border bg-accent/30 px-2 py-1 shrink-0 cursor-pointer hover:text-foreground transition-colors',
                  STATUS_CLASSES[task.status],
                )}
              >
                #{task.id}
              </button>
              {showReopen ? (
                <Button size="sm" variant="outline" onClick={() => onStatus(task.id, 'todo')}
                  className={cn('text-xs h-auto px-2 py-1 border-l-0', STATUS_CLASSES[task.status])}>
                  Re-open
                </Button>
              ) : (
                <StatusPicker value={task.status} options={STATUSES} onChange={(st) => onStatus(task.id, st)} className="border-l-0" />
              )}
            </div>
            {noteCount > 0 && (
              <button
                type="button"
                onClick={() => setView('full')}
                className={cn(notesPillClass, 'cursor-pointer hover:border-primary/60 hover:text-foreground transition-colors')}
              >
                {notesLabel}
              </button>
            )}
            {task.externalId && (
              <span title={task.externalId} className={cn(externalIdClass, 'min-w-0 max-w-48')}>{task.externalId}</span>
            )}
            {prTags}
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {task.plan && (
              <button
                type="button"
                onClick={() => setPlanOpen(true)}
                className="inline-flex items-center text-muted-foreground hover:text-primary cursor-pointer transition-colors shrink-0"
                title="View plan"
              >
                <FileText className="w-4 h-4" strokeWidth={1.5} />
              </button>
            )}

            {task.parentId !== undefined && !nested && (
              <button
                type="button"
                onClick={() => onRefClick?.(task.parentId!)}
                className={cn(
                  'text-xs tracking-widest uppercase border border-border px-2 py-1 text-muted-foreground transition-colors max-w-48 truncate',
                  onRefClick && 'hover:border-primary/60 hover:text-foreground cursor-pointer',
                )}
              >
                EPIC #{task.parentId}{task.epicTitle && <span className="ml-1 normal-case tracking-normal text-muted-foreground/50">{task.epicTitle}</span>}
              </button>
            )}

            {progress && progress.total > 0 && (
              <span className="text-xs tracking-widest border border-border px-2 py-1 shrink-0 text-muted-foreground">
                {progress.done}/{progress.total}
              </span>
            )}

            {task.scope && (
              <span className="text-xs tracking-widest text-primary/70 border border-primary/30 px-2 py-1 shrink-0">
                {task.scope}
              </span>
            )}

            <span className="text-xs tracking-widest text-muted-foreground border border-border px-2 py-1 shrink-0">
              {TYPE_LABELS[task.type] ?? task.type.toUpperCase()}
            </span>

            <span className={cn(
              'text-xs tracking-widest border px-2 py-1 shrink-0',
              PRIORITY_CLASSES[task.priority],
            )}>
              {task.priority.toUpperCase()}
            </span>

            <button
              type="button"
              onClick={() => setView(next)}
              aria-label={VIEW_LABELS[next]}
              title={VIEW_LABELS[next]}
              className="inline-flex items-center border border-border px-2 py-1 text-muted-foreground hover:border-primary/60 hover:text-foreground cursor-pointer transition-colors shrink-0"
            >
              <ViewIcon className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2 min-w-0">
          {onToggleCollapse && (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand epic' : 'Collapse epic'}
              onClick={onToggleCollapse}
              className="inline-flex items-center h-[1.625rem] text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {collapsed
                ? <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                : <ChevronDown className="w-4 h-4" strokeWidth={1.5} />
              }
            </button>
          )}
          <span className="text-base text-foreground leading-[1.625rem] break-words min-w-0">{task.title}</span>
        </div>
      </div>

      {view === 'collapsed' && (
        <div className="px-3 pb-2">
          {hasSummary
            ? <div className="text-sm text-muted-foreground leading-relaxed">{task.summary}</div>
            : renderDescription(true)}
        </div>
      )}

      {view === 'full' && (
        <div className="px-3 pb-2">
          {renderDescription(false)}
          {notes.length > 0 && <NotesSection notes={notes} />}
        </div>
      )}

      {view !== 'compact' && (
        <div className="flex items-end gap-6 px-3 pb-3 border-t border-border/50 pt-2">
          {task.refs && task.refs.length > 0 && (
            <div className="flex-1 min-w-0 flex flex-wrap gap-2">
              {task.refs.map((ref) => {
                const target = refTargets?.get(ref.id);
                return (
                  <button
                    key={ref.id}
                    type="button"
                    onClick={() => onRefClick?.(ref.id)}
                    title={target && `${STATUS_LABELS[target.status]} | ${target.title}`}
                    className={cn(
                      'text-xs tracking-widest border border-border px-2 py-1 text-muted-foreground transition-colors',
                      onRefClick && 'hover:border-primary/60 hover:text-foreground cursor-pointer',
                    )}
                  >
                    <span className="text-muted-foreground/50 mr-1 normal-case tracking-normal">{ref.relation}</span><span className={REF_STATUS_CLASSES[target?.status ?? 'todo']}>#{ref.id}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="ml-auto flex gap-2 shrink-0">
            {onAddChild && task.type === 'epic' && task.status !== 'done' && (
              <Button size="sm" variant="outline" onClick={() => onAddChild(task)}>
                + Task
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onEdit(task)}>
              Edit
            </Button>
          </div>
        </div>
      )}

      {task.plan && (
        <Dialog open={planOpen} onOpenChange={setPlanOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogTitle>Plan</DialogTitle>
            <div className="prose-task text-sm text-muted-foreground leading-relaxed">
              <Markdown remarkPlugins={[remarkGfm]}>{task.plan}</Markdown>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
