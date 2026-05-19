import { useEffect, useState } from 'react';
import TaskManager from './client/TaskManager';
import { Toaster } from './components/ui/sonner';
import Footer from './components/Footer';
import ModeExplainer from './components/ModeExplainer';

type RunMode = 'bundled' | 'standalone' | 'disabled';

type Config = {
  name: string | null;
  mode: RunMode;
  version: string | null;
};

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Partial<Record<string, unknown>>) => {
        if (cancelled) return;
        const name = typeof data?.name === 'string' && data.name.length > 0 ? data.name : null;
        const mode: RunMode = data?.mode === 'standalone' || data?.mode === 'disabled' ? data.mode : 'bundled';
        const version = typeof data?.version === 'string' && data.version.length > 0 ? data.version : null;
        setConfig({ name, mode, version });
        if (name) document.title = `${name} · tasks`;
      })
      .catch(() => { /* leave defaults in place */ });
    return () => { cancelled = true; };
  }, []);

  const projectName = config?.name ?? null;
  const mode = config?.mode ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-[1080px] mx-auto px-8 py-5 flex items-center justify-between gap-6">
          <span className="font-bold uppercase tracking-widest text-lg text-foreground">
            task<span className="text-primary">/</span>manager
          </span>
          {projectName && (
            <div className="flex flex-col items-end gap-1">
              <span className="font-bold uppercase tracking-widest text-lg text-foreground">
                {projectName}
              </span>
              {mode && <ModeExplainer currentMode={mode} />}
            </div>
          )}
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-[1080px] mx-auto px-8 pt-12 pb-20">
          <TaskManager />
        </div>
      </main>
      <Footer
        version={config?.version ?? null}
        repoUrl="https://github.com/dabalroman/mcp-servers"
        projectName={projectName}
        mode={mode}
      />
      <Toaster position="bottom-right" />
    </div>
  );
}
