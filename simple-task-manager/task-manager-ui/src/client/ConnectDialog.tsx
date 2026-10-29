import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CodeBlock, copyText } from '@/components/CodeBlock';
import { addLine, mcpUrlFor, setupPrompt } from '@/lib/connectSetup';

type ApiKey = { id: number; label: string; project: string | null; createdAt: string; lastUsedAt: string | null };
type Created = { key: string; url: string; project: string };
type Project = { name: string };

const INPUT = 'bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary';
const LABEL = 'text-xs tracking-widest text-muted-foreground uppercase';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export type ConnectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ConnectDialog({ open, onOpenChange }: ConnectDialogProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState(() => mcpUrlFor(window.location.origin));
  const [submitting, setSubmitting] = useState(false);
  // Held only until the dialog closes: the server never returns it again.
  const [created, setCreated] = useState<Created | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [k, p] = await Promise.all([api<ApiKey[]>('/api/keys'), api<Project[]>('/api/projects')]);
      setKeys(k);
      setProjects(p.map((x) => x.name));
      setProject((cur) => cur || (p[0]?.name ?? ''));
    } catch (err) {
      toast.error(`Failed to load keys. ${err instanceof Error ? err.message : ''}`);
    }
  }, []);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!label.trim() || !url.trim() || !project || submitting) return;
    setSubmitting(true);
    try {
      const { key } = await api<{ key: string }>('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), project }),
      });
      setCreated({ key, url: url.trim(), project });
      setLabel('');
      void refresh();
    } catch (err) {
      toast.error(`Failed to create key. ${err instanceof Error ? err.message : ''}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(k: ApiKey) {
    if (!window.confirm(`Revoke key "${k.label}"? The repo using it loses access immediately.`)) return;
    try {
      await api(`/api/keys/${k.id}/revoke`, { method: 'POST' });
      void refresh();
    } catch (err) {
      toast.error(`Failed to revoke key. ${err instanceof Error ? err.message : ''}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">Connect a machine</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A repo in client mode reaches this server over HTTP at /mcp with an API key. Create one key per repo.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-foreground">
              This key is shown once: closing this view discards it. Both the line and the prompt contain the key, so treat them like one.
            </p>
            <div className="flex flex-col gap-2">
              <span className={LABEL}>Run in the repo</span>
              <CodeBlock text={addLine(created)} copyable />
              <p className="text-xs text-muted-foreground">
                Claude Code keeps local-scope entries in your ~/.claude.json, not in the repo, so the key is never committed. If the repo already has a task-manager entry, run claude mcp remove task-manager -s local first.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={(e) => copyText(setupPrompt(created), e.currentTarget)}>
                Copy setup prompt for agent
              </Button>
              <Button size="sm" onClick={() => setCreated(null)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Label</span>
                <input autoFocus required maxLength={64} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. laptop / my-repo" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Default project</span>
                <select value={project} onChange={(e) => setProject(e.target.value)} className={INPUT}>
                  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <span className="text-2xs text-muted-foreground">Used when a tool call names no project. Others stay reachable.</span>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Server URL</span>
              <input required value={url} onChange={(e) => setUrl(e.target.value)} className={INPUT} />
              <span className="text-2xs text-muted-foreground">From another machine, use the address it reaches this server at (e.g. your HTTPS proxy URL).</span>
            </label>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={submitting || !label.trim() || !url.trim() || !project}>
                {submitting ? 'Creating…' : 'Create key'}
              </Button>
            </div>
          </form>
        )}

        <div className="flex flex-col gap-2">
          <span className={LABEL}>Keys</span>
          {keys.length === 0 ? (
            <p className="text-muted-foreground text-base">No keys yet. Create one to connect a repo.</p>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="border border-border bg-card px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-foreground truncate">
                    {k.label} <span className="text-muted-foreground">· {k.project ?? 'no default project'}</span>
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    created {k.createdAt} UTC · last used {k.lastUsedAt ? `${k.lastUsedAt} UTC` : 'never'}
                  </span>
                </div>
                <Button size="sm" variant="destructive" className="shrink-0" onClick={() => void revoke(k)}>Revoke</Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
