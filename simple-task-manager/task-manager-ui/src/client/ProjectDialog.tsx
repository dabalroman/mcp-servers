import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type ProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Resolves false when creation failed and the dialog should stay open.
  onSubmit: (name: string) => Promise<boolean>;
};

export function ProjectDialog({ open, onOpenChange, onSubmit }: ProjectDialogProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onSubmit(name.trim())) onOpenChange(false);
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
