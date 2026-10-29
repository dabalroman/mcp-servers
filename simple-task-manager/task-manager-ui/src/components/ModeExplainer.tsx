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

type RunMode = 'bundled' | 'standalone' | 'disabled';

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
    description: 'Default. The MCP spawns the UI as a child process; the UI dies with the MCP. Leaving standalone: the repo that started the shared UI also deletes its pm2 app; any other repo just stops using it.',
    switchLabel: 'Switch to this mode:',
    commands: [
      {
        text: `npx tsx ${packageDir ?? '<package dir>'}/setup-standalone.ts off`,
        copyable: true,
      },
    ],
  },
  {
    mode: 'standalone',
    label: 'Standalone',
    description: `The UI runs as the long-lived pm2 app "${pm2AppName()}", independent of the MCP, and survives MCP restarts. One UI serves every repo on the same database and port: the first repo to switch starts it, later repos join it.`,
    switchLabel: 'Switch to this mode:',
    commands: [
      {
        text: `npx tsx ${packageDir ?? '<package dir>'}/setup-standalone.ts on`,
        copyable: true,
      },
    ],
  },
  {
    mode: 'disabled',
    label: 'Disabled',
    description: 'The MCP runs without spawning a UI.',
    switchLabel: 'Switch to this mode:',
    commands: [
      { text: '1. Set TASK_UI_MODE to "disabled" in .mcp.json:', copyable: false },
      { text: '"TASK_UI_MODE": "disabled"', copyable: true },
      { text: '2. Restart Claude Code.', copyable: false },
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
              Three modes control how the task-manager UI process is managed. Run the commands in the repo directory (where .mcp.json lives), then restart Claude Code.
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
