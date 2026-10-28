import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { pm2AppName } from '../lib/pm2';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type RunMode = 'bundled' | 'standalone' | 'disabled';

type UpdateAvailableBadgeProps = {
  localVersion: string | null;
  remoteVersion: string;
  mode: RunMode | null;
  packageDir: string | null;
};

export default function UpdateAvailableBadge({ localVersion, remoteVersion, mode, packageDir }: UpdateAvailableBadgeProps) {
  const [open, setOpen] = useState(false);

  const restartNote = mode === 'bundled' ? ' (this also restarts the UI)' : '';
  const dir = packageDir ?? '<package dir>';
  const steps = [
    `git -C ${dir} pull`,
    `Re-run npx tsx ${dir}/install.ts in each project (rebuilds dist/)`,
    `Restart Claude Code${restartNote}`,
  ];
  if (mode === 'standalone') {
    steps.push(`Standalone mode: pm2 restart ${pm2AppName()}`);
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-warning hover:text-warning/80 transition-colors"
        onClick={() => setOpen(true)}
        aria-label="Update available"
      >
        <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.5} />
        Update available: v{remoteVersion}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="text-sm tracking-widest uppercase">Update available</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Local v{localVersion ?? 'unknown'} · Remote v{remoteVersion}
            </DialogDescription>
          </DialogHeader>

          <ol className="flex flex-col gap-2 mt-2 text-xs text-foreground list-decimal list-inside">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
