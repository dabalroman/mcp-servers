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
  projects: { name: string; open: number }[];
  current: string | null;
  onSelect: (name: string) => void;
  onNewProject: () => void;
}

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="text-2xs tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
    {children}
  </span>
);

export function ProjectSwitcher({ projects, current, onSelect, onNewProject }: Props) {
  const active = projects.find((p) => p.name === current);
  // Opening the dialog while the menu is still closing leaves the page pointer-locked; defer it until the menu has closed.
  const newProjectPending = useRef(false);
  return (
    <>
      {projects.length > 1 && (
        <div className="hidden sm:flex flex-wrap border-b border-border">
          {projects.map((p) => (
            <button
              key={p.name}
              onClick={() => onSelect(p.name)}
              className={cn(
                'flex items-center gap-2 px-5 py-2 tracking-widest uppercase transition-colors border-b-2 -mb-px',
                p.name === current
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
              if (!newProjectPending.current) return;
              newProjectPending.current = false;
              e.preventDefault();
              onNewProject();
            }}
          >
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.name}
                onSelect={() => onSelect(p.name)}
                className={cn('justify-between', p.name === current && 'text-primary')}
              >
                <span className="truncate">{p.name}</span>
                <Badge>{p.open}</Badge>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { newProjectPending.current = true; }}>+ Project</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
