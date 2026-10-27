import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, ChevronUp, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { TYPE_LABELS, PRIORITY_CLASSES, STATUS_LABELS, STATUS_CLASSES } from './constants';
import type { EpicProgress } from '@/lib/taskView';
import type { Note, Task, TaskStatus } from '@/types/task';

const STATUSES: TaskStatus[] = ['refinement', 'plan', 'todo', 'in_progress', 'done'];

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
  onStatus: (id: number, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onRefClick?: (id: number) => void;
  highlighted?: boolean;
  showReopen?: boolean;
  progress?: EpicProgress;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  nested?: boolean;
  sticky?: boolean;
};

export function TaskCard({ task, onStatus, onEdit, onRefClick, highlighted = false, showReopen = false, progress, collapsed = false, onToggleCollapse, nested = false, sticky = false }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const hasSummary = Boolean(task.summary);
  const notes = task.notes ?? [];
  const noteCount = task.noteCount ?? notes.length;

  const idButtonClass =
    'text-xs tracking-widest border border-border px-2 py-1 shrink-0 text-muted-foreground cursor-pointer hover:border-primary/60 hover:text-foreground transition-colors';
  const externalIdClass = 'text-xs tracking-widest border border-border px-2 py-1 truncate text-muted-foreground';

  const copyIdCommand = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const cmd =
      task.status === 'refinement' ? `/refine #${task.id}` :
      task.status === 'plan' ? `/plan #${task.id}` :
      task.status === 'todo' || task.status === 'in_progress' ? `/implement #${task.id}` :
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

  return (
    <div
      data-task-id={task.id}
      className={cn(
        'border bg-card flex flex-col gap-0 transition-[border-color,box-shadow] duration-500 overflow-hidden',
        task.status === 'done' && 'opacity-60',
        // An expanded card can be taller than the viewport; only pin the compact one.
        sticky && !expanded && 'sticky top-0 z-10',
        highlighted ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]' : 'border-border',
      )}
    >
      <div className="flex flex-col-reverse gap-3 px-3 pt-3 pb-2 md:flex-row md:items-start md:gap-2">
        <button
          type="button"
          onClick={copyIdCommand}
          className={cn(idButtonClass, 'hidden md:inline-flex items-center self-start')}
        >
          #{task.id}
        </button>
        {task.externalId && (
          <span title={task.externalId} className={cn(externalIdClass, 'hidden md:inline-block self-start max-w-48')}>
            {task.externalId}
          </span>
        )}

        <div className="flex items-start gap-2 md:flex-1 md:min-w-0">
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

        <div className="flex items-center justify-between gap-2 w-full md:w-auto md:justify-start">
          <div className="flex items-center gap-2 min-w-0 md:hidden">
            <button
              type="button"
              onClick={copyIdCommand}
              className={idButtonClass}
            >
              #{task.id}
            </button>
            {task.externalId && (
              <span title={task.externalId} className={cn(externalIdClass, 'min-w-0')}>{task.externalId}</span>
            )}
          </div>

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

        </div>
      </div>

      {hasSummary ? (
        <div className="px-3 pb-2">
          {!expanded && (
            <div className="text-sm text-muted-foreground leading-relaxed">
              {task.summary}
            </div>
          )}
          {expanded && (
            <div className="text-sm text-muted-foreground leading-relaxed prose-task">
              <Markdown remarkPlugins={[remarkGfm]}>{task.description ?? ''}</Markdown>
            </div>
          )}
          {expanded && notes.length > 0 && <NotesSection notes={notes} />}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {expanded
              ? <ChevronUp className="w-3 h-3 shrink-0" strokeWidth={1.5} />
              : <ChevronDown className="w-3 h-3 shrink-0" strokeWidth={1.5} />
            }
            <span>{expanded ? 'Hide details' : 'Show details'}</span>
          </button>
          {!expanded && noteCount > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-xs tracking-widest uppercase border border-border px-2 py-1 text-muted-foreground">
                {noteCount} {noteCount === 1 ? 'note' : 'notes'}
              </span>
            </div>
          )}
          {task.refs && task.refs.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {task.refs.map((ref) => (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() => onRefClick?.(ref.id)}
                  className={cn(
                    'text-xs tracking-widest border border-border px-2 py-1 text-muted-foreground transition-colors',
                    onRefClick && 'hover:border-primary/60 hover:text-foreground cursor-pointer',
                  )}
                >
                  #{ref.id}<span className="text-muted-foreground/50 ml-1 normal-case tracking-normal">{ref.relation}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 pb-2">
          {task.description ? (
            <div className="text-sm text-muted-foreground leading-relaxed prose-task">
              <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">No description.</span>
          )}
          {notes.length > 0 && <NotesSection notes={notes} />}
          {task.refs && task.refs.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {task.refs.map((ref) => (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() => onRefClick?.(ref.id)}
                  className={cn(
                    'text-xs tracking-widest border border-border px-2 py-1 text-muted-foreground transition-colors',
                    onRefClick && 'hover:border-primary/60 hover:text-foreground cursor-pointer',
                  )}
                >
                  #{ref.id}<span className="text-muted-foreground/50 ml-1 normal-case tracking-normal">{ref.relation}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 pb-3 border-t border-border/50 pt-2">
        {showReopen ? (
          <Button size="sm" variant="outline" onClick={() => onStatus(task.id, 'todo')}
            className="text-xs h-6 px-2">
            Re-open
          </Button>
        ) : (
          <div className="flex border border-border divide-x divide-border">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => s !== task.status && onStatus(task.id, s)}
                className={cn(
                  'text-xs tracking-widest px-2 py-1 transition-colors',
                  s === task.status
                    ? STATUS_CLASSES[s] + ' bg-accent/30'
                    : 'text-muted-foreground/40 hover:text-muted-foreground',
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        <Button size="sm" variant="outline" className="ml-auto" onClick={() => onEdit(task)}>
          Edit
        </Button>
      </div>

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
