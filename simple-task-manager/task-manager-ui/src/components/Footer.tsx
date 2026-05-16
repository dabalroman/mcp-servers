import { Github, Tag, Database } from 'lucide-react';

type RunMode = 'bundled' | 'standalone' | 'disabled';

type FooterProps = {
  version: string | null;
  tasksDb: string | null;
  repoUrl: string;
  projectName: string | null;
  mode: RunMode | null;
};

export default function Footer({ version, tasksDb, repoUrl, projectName, mode }: FooterProps) {
  return (
    <footer className="mt-8 border-t border-border bg-card">
      <div className="max-w-[1080px] mx-auto px-8 py-5 flex items-center justify-between gap-6">
        <span className="font-bold uppercase tracking-widest text-lg text-foreground">
          task<span className="text-primary">/</span>manager
        </span>
        {projectName && (
          <div className="flex flex-col items-end gap-1">
            <span className="font-bold uppercase tracking-widest text-lg text-foreground">
              {projectName}
            </span>
            {mode && (
              <span className="text-xs tracking-widest uppercase text-muted-foreground">
                {mode} mode
              </span>
            )}
          </div>
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
        {tasksDb && (
          <div className="flex items-center gap-1 min-w-0">
            <Database className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate" title={tasksDb}>{tasksDb}</span>
          </div>
        )}
      </div>
    </footer>
  );
}
