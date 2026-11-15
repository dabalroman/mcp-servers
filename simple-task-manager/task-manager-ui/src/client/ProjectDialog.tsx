import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const PROJECT_DESCRIPTION_MAX = 280;

export type ProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Resolves false when creating failed and the dialog should stay open.
  onSubmit: (project: { name: string; description: string }) => Promise<boolean>;
};

export function ProjectDialog({ open, onOpenChange, onSubmit }: ProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onSubmit({ name: name.trim(), description: description.trim() })) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">New Project</DialogTitle>
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
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
