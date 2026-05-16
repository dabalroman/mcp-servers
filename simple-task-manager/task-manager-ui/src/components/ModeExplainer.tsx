import { useState } from 'react';
import { Info, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type RunMode = 'bundled' | 'standalone' | 'disabled';

type ModeBlock = {
  mode: RunMode;
  label: string;
  description: string;
  switchLabel: string;
  commands: { text: string; copyable: boolean }[];
};

const MODES: ModeBlock[] = [
  {
    mode: 'bundled',
    label: 'Bundled',
    description: 'Default. The MCP spawns the UI as a child process; the UI dies with the MCP.',
    switchLabel: 'Switch to this mode:',
    commands: [
      {
        text: 'npx tsx ~/.claude/mcp-servers/simple-task-manager/setup-standalone.ts off',
        copyable: true,
      },
    ],
  },
  {
    mode: 'standalone',
    label: 'Standalone',
    description: 'The UI runs as a long-lived pm2 process, independent of the MCP. Survives MCP restarts.',
    switchLabel: 'Switch to this mode:',
    commands: [
      {
        text: 'npx tsx ~/.claude/mcp-servers/simple-task-manager/setup-standalone.ts on',
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
      { text: '2. Restart Claude Code to apply.', copyable: false },
    ],
  },
];

function execCopy(text: string, container: HTMLElement) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  container.appendChild(el);
  el.focus();
  el.select();
  try {
    document.execCommand('copy');
    toast.success('Copied');
  } catch {
    toast.error('Copy failed');
  }
  container.removeChild(el);
}

function CodeBlock({ text, copyable }: { text: string; copyable: boolean }) {
  const [hovered, setHovered] = useState(false);

  function handleClick(e: React.MouseEvent) {
    if (!copyable) return;
    const container = (e.currentTarget as HTMLElement).closest('[role="dialog"]') as HTMLElement ?? document.body;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => execCopy(text, container));
    } else {
      execCopy(text, container);
    }
  }

  return (
    <code
      className={[
        'relative block font-mono text-2xs bg-background border border-border rounded px-3 py-2 text-foreground break-all',
        copyable ? 'cursor-pointer hover:bg-accent/20 hover:border-primary/50 transition-colors' : '',
      ].join(' ')}
      onClick={copyable ? handleClick : undefined as never}
      onMouseEnter={() => copyable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {text}
      {copyable && hovered && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
        </span>
      )}
    </code>
  );
}

export default function ModeExplainer({ currentMode }: { currentMode: RunMode }) {
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
              Three modes control how the task-manager UI process is managed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 mt-2">
            {MODES.map((block) => {
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
