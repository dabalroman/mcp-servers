import { useState } from 'react';
import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { pm2AppName } from '../lib/pm2';
import { CodeBlock } from './CodeBlock';

type RunMode = 'bundled' | 'server';

type ModeBlock = {
  mode: RunMode;
  label: string;
  description: string;
  switchLabel: string;
  commands: { text: string; copyable: boolean }[];
};

// packageDir is unknown until /api/config answers; show a placeholder meanwhile.
const modes = (packageDir: string | null): ModeBlock[] => [
  {
    mode: 'bundled',
    label: 'Bundled',
    description: 'Default. Each repo runs its own stdio MCP, which spawns its own UI as a child process; the UI dies with the session.',
    switchLabel: 'Set up a repo (run in it, then restart Claude Code):',
    commands: [
      {
        text: `npx tsx ${packageDir ?? '<package dir>'}/install.ts`,
        copyable: true,
      },
    ],
  },
  {
    mode: 'server',
    label: 'Server + clients',
    description: `One long-lived pm2 app, "${pm2AppName()}", serves this UI and the MCP over HTTP for every project on its database. Repos connect in client mode and run no task-manager process of their own.`,
    switchLabel: 'Start the server (run in the dir that should own it):',
    commands: [
      {
        text: `npx tsx ${packageDir ?? '<package dir>'}/install.ts --server on`,
        copyable: true,
      },
      { text: 'Then, per repo: click Connect a machine in the footer and run the line it prints in that repo.', copyable: false },
    ],
  },
];

export default function ModeExplainer({ currentMode, packageDir }: { currentMode: RunMode; packageDir: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground cursor-pointer hover:text-primary transition-colors"
        onClick={() => setOpen(true)}
        aria-label="Show UI mode info"
      >
        {currentMode} mode
        <Info className="w-3 h-3 shrink-0" strokeWidth={1.5} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="text-sm tracking-widest uppercase">UI run mode</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Two modes control how the task-manager runs: per repo, or as one shared server.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 mt-2">
            {modes(packageDir).map((block) => {
              const isActive = block.mode === currentMode;
              return (
                <div
                  key={block.mode}
                  className={[
                    'relative border rounded p-4 flex flex-col gap-2',
                    isActive ? 'border-primary' : 'border-border',
                  ].join(' ')}
                >
                  {isActive && (
                    <span className="absolute top-3 right-3 text-2xs tracking-widest uppercase border border-primary text-primary px-2 py-0.5 rounded">
                      ACTIVE
                    </span>
                  )}
                  <span className="text-sm tracking-widest uppercase font-semibold text-foreground pr-16">
                    {block.label}
                  </span>
                  <p className="text-xs text-muted-foreground">{block.description}</p>
                  <p className="text-2xs tracking-widest uppercase text-muted-foreground mt-1">
                    {block.switchLabel}
                  </p>
                  <div className="flex flex-col gap-2">
                    {block.commands.map((cmd, i) =>
                      cmd.copyable ? (
                        <CodeBlock key={i} text={cmd.text} copyable />
                      ) : (
                        <p key={i} className="text-xs text-muted-foreground">
                          {cmd.text}
                        </p>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
