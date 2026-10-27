import { useEffect, useState } from 'react';
import TaskManager from './client/TaskManager';
import { Toaster } from './components/ui/sonner';
import Footer from './components/Footer';
import ModeExplainer from './components/ModeExplainer';
import UpdateAvailableBadge from './components/UpdateAvailableBadge';

type RunMode = 'bundled' | 'standalone' | 'disabled';
type UpdateState = 'available' | 'current' | 'unknown';
type UpdateInfo = { state: UpdateState; remote: string | null };

type Config = {
  name: string | null;
  mode: RunMode;
  version: string | null;
  packageDir: string | null;
  update: UpdateInfo;
};

const DEFAULT_UPDATE: UpdateInfo = { state: 'unknown', remote: null };

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
        const packageDir = typeof data?.packageDir === 'string' && data.packageDir.length > 0 ? data.packageDir : null;
        const rawUpdate = data?.update as Partial<Record<string, unknown>> | undefined;
        const updateState: UpdateState =
          rawUpdate?.state === 'available' || rawUpdate?.state === 'current' ? rawUpdate.state : 'unknown';
        const updateRemote = typeof rawUpdate?.remote === 'string' && rawUpdate.remote.length > 0 ? rawUpdate.remote : null;
        setConfig({ name, mode, version, packageDir, update: { state: updateState, remote: updateRemote } });
        if (name) document.title = `${name} · tasks`;
      })
      .catch(() => { /* leave defaults in place */ });
    return () => { cancelled = true; };
  }, []);

  const projectName = config?.name ?? null;
  const mode = config?.mode ?? null;
  const packageDir = config?.packageDir ?? null;
  const update = config?.update ?? DEFAULT_UPDATE;
  const updateRemoteVersion = update.state === 'available' ? update.remote : null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-[1080px] mx-auto px-8 py-5 flex items-center justify-between gap-6">
          <span className="font-bold uppercase tracking-widest text-lg text-foreground">
            task<span className="text-primary">/</span>manager
          </span>
          {(projectName || updateRemoteVersion) && (
            <div className="flex flex-col items-end gap-1">
              {projectName && (
                <span className="font-bold uppercase tracking-widest text-lg text-foreground">
                  {projectName}
                </span>
              )}
              {mode && <ModeExplainer currentMode={mode} packageDir={packageDir} />}
              {updateRemoteVersion && (
                <UpdateAvailableBadge
                  localVersion={config?.version ?? null}
                  remoteVersion={updateRemoteVersion}
                  mode={mode}
                  projectName={projectName}
                  packageDir={packageDir}
                />
              )}
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
