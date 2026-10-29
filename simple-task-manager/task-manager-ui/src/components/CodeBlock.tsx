import { useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

// navigator.clipboard is missing over plain HTTP on the LAN; execCommand covers it.
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

// The fallback textarea must sit inside an open dialog, or its focus trap blocks the copy.
export function copyText(text: string, from: HTMLElement) {
  const container = from.closest('[role="dialog"]') as HTMLElement ?? document.body;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => execCopy(text, container));
  } else {
    execCopy(text, container);
  }
}

export function CodeBlock({ text, copyable }: { text: string; copyable: boolean }) {
  const [hovered, setHovered] = useState(false);

  function handleClick(e: React.MouseEvent) {
    if (!copyable) return;
    copyText(text, e.currentTarget as HTMLElement);
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

