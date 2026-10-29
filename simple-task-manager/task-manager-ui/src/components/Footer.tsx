import { useState } from 'react';
import { Github, Plug, Tag } from 'lucide-react';
import { ConnectDialog } from '@/client/ConnectDialog';

type RunMode = 'bundled' | 'server';

type FooterProps = {
  version: string | null;
  repoUrl: string;
  mode: RunMode | null;
};

export default function Footer({ version, repoUrl, mode }: FooterProps) {
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <footer className="mt-8 border-t border-border bg-card">
      <div className="max-w-[1080px] mx-auto px-8 py-5 flex items-center justify-between gap-6">
        <span className="font-bold uppercase tracking-widest text-lg text-foreground">
          task<span className="text-primary">/</span>manager
        </span>
        {mode && (
          <span className="text-xs tracking-widest uppercase text-muted-foreground">
            {mode} mode
          </span>
        )}
      </div>
      <div className="max-w-[1080px] mx-auto px-8 pb-6 flex items-center justify-between gap-4 text-2xs tracking-widest text-muted-foreground uppercase border-t border-border/50 pt-4">
        <div className="flex items-center gap-4 shrink-0">
          {version && (
            <span className="flex items-center gap-1">
              <Tag className="w-4 h-4 shrink-0" strokeWidth={1.5} />
              v{version}
            </span>
          )}
          <a href={repoUrl} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 hover:text-foreground transition-colors">
            <Github className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            GitHub
          </a>
        </div>
        <button type="button" onClick={() => setConnectOpen(true)}
                className="flex items-center gap-1 uppercase tracking-widest hover:text-foreground transition-colors">
          <Plug className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          Connect a machine
        </button>
      </div>
      {/* Remounted per open so a created key leaves memory on close. */}
      <ConnectDialog key={String(connectOpen)} open={connectOpen} onOpenChange={setConnectOpen} />
    </footer>
  );
}
