import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { TYPE_LABELS, PRIORITY_CLASSES, STATUS_LABELS, STATUS_CLASSES } from './constants';
import type { Task, TaskStatus } from '@/types/task';

const STATUSES: TaskStatus[] = ['refinement', 'todo', 'in_progress', 'done'];

export type TaskCardProps = {
  task: Task;
  onStatus: (id: number, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onRefClick?: (id: number) => void;
  highlighted?: boolean;
  showReopen?: boolean;
};

export function TaskCard({ task, onStatus, onEdit, onRefClick, highlighted = false, showReopen = false }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const hasSummary = Boolean(task.summary);

  const idButtonClass =
    'text-xs tracking-widest border border-border px-2 py-1 shrink-0 text-muted-foreground cursor-pointer hover:border-primary/60 hover:text-foreground transition-colors';

  const copyIdCommand = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const cmd =
      task.status === 'refinement' ? `/refine #${task.id}` :
      task.status === 'todo' || task.status === 'in_progress' ? `/implement #${task.id}` :
      `#${task.id}`;
    const successMsg =
      task.status === 'refinement' ? 'Copied — paste into Claude Code to refine' :
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
        highlighted ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]' : 'border-border',
      )}
    >
      <div className="flex flex-col-reverse gap-3 px-3 pt-3 pb-2 sm:flex-row sm:items-start sm:gap-2">
        <button
          type="button"
          onClick={copyIdCommand}
          className={cn(idButtonClass, 'hidden md:inline-flex items-center self-start')}
        >
          #{task.id}
        </button>

        <div className="flex items-start gap-2 sm:flex-1 sm:min-w-0">
          <span className="text-base text-foreground leading-[1.625rem] break-words min-w-0">{task.title}</span>
        </div>

        <div className="flex items-center justify-between gap-2 w-full sm:w-auto sm:justify-start">
          <button
            type="button"
            onClick={copyIdCommand}
            className={cn(idButtonClass, 'md:hidden')}
          >
            #{task.id}
          </button>

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
