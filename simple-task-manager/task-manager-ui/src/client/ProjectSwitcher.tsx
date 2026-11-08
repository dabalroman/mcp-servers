import { useRef } from 'react';
import { ChevronDown, Menu } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  projects: { id: string; name: string; open: number }[];
  current: string | null;
  onSelect: (id: string) => void;
  onNewProject: () => void;
  onEditProject: () => void;
}

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="text-2xs tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
    {children}
  </span>
);

export function ProjectSwitcher({ projects, current, onSelect, onNewProject, onEditProject }: Props) {
  const active = projects.find((p) => p.id === current);
  // Opening a dialog while the menu is still closing leaves the page pointer-locked; defer it until the menu has closed.
  const pendingDialog = useRef<'new' | 'edit' | null>(null);
  return (
    <>
      {projects.length > 1 && (
        <div className="hidden sm:flex flex-wrap border-b border-border">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={cn(
                'flex items-center gap-2 px-5 py-2 tracking-widest uppercase transition-colors border-b-2 -mb-px',
                p.id === current
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-xs">{p.name}</span>
              <Badge>{p.open}</Badge>
            </button>
          ))}
        </div>
      )}

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 border border-border px-3 py-2 text-primary tracking-widest uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Menu className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left text-xs">{active?.name ?? 'No project'}</span>
            {active && <Badge>{active.open}</Badge>}
            <ChevronDown className="h-4 w-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[var(--radix-dropdown-menu-trigger-width)]"
            onCloseAutoFocus={(e) => {
              const pending = pendingDialog.current;
              if (!pending) return;
              pendingDialog.current = null;
              e.preventDefault();
              if (pending === 'new') onNewProject();
              else onEditProject();
            }}
          >
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onSelect={() => onSelect(p.id)}
                className={cn('justify-between', p.id === current && 'text-primary')}
              >
                <span className="truncate">{p.name}</span>
                <Badge>{p.open}</Badge>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {active && <DropdownMenuItem onSelect={() => { pendingDialog.current = 'edit'; }}>Edit project</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => { pendingDialog.current = 'new'; }}>New project</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
