import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Project } from '@/types/task';

const PROJECT_DESCRIPTION_MAX = 280;

type ProjectSettings = { name: string; trackPrs: boolean; description: string };

export type ProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Set = edit this project; unset = create a new one.
  initial?: Pick<Project, 'id' | 'name' | 'trackPrs' | 'description'>;
  // Resolves false when saving failed and the dialog should stay open.
  onSubmit: (settings: ProjectSettings) => Promise<boolean>;
};

export function ProjectDialog({ open, onOpenChange, initial, onSubmit }: ProjectDialogProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trackPrs, setTrackPrs] = useState(initial?.trackPrs ?? false);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const editing = initial !== undefined;
  const [idleLabel, busyLabel] = editing ? ['Save', 'Saving…'] : ['Create', 'Creating…'];
  const submitLabel = submitting ? busyLabel : idleLabel;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onSubmit({ name: name.trim(), trackPrs, description: description.trim() })) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">{editing ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-widest text-muted-foreground uppercase">Name</span>
            <input
              autoFocus
              required
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-repo"
              className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-widest text-muted-foreground uppercase">Description</span>
            <textarea
              rows={3}
              maxLength={PROJECT_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this project covers, so agents can tell projects apart"
              className="bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-y"
            />
            <span className="self-end text-xs text-muted-foreground">{description.length}/{PROJECT_DESCRIPTION_MAX}</span>
          </label>
          {editing && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs tracking-widest text-muted-foreground uppercase">Id</span>
                <code className="text-sm text-foreground">{initial.id}</code>
                <span className="text-xs text-muted-foreground">Fixed. Used in PROJECT_NAME, API keys and URLs; renaming doesn't change it.</span>
              </div>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={trackPrs}
                  onChange={(e) => setTrackPrs(e.target.checked)}
                  className="mt-1 accent-primary"
                />
                <span className="flex flex-col gap-1">
                  <span className="text-xs tracking-widest text-foreground uppercase">Track PRs</span>
                  <span className="text-xs text-muted-foreground">Agents are told to record the PRs/MRs they open, from their next session.</span>
                </span>
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
