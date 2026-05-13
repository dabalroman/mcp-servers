import type { ReactNode } from 'react';

export type ToolHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
};

export function ToolHeader({ title, description, status, actions }: ToolHeaderProps) {
  return (
    <header>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="text-lg font-bold tracking-wider text-foreground">
          {title}
        </h1>
        {(status || actions) && (
          <div className="flex items-baseline gap-3 shrink-0">
            {status && (
              <span className="text-xs tracking-widest uppercase text-muted-foreground">
                {status}
              </span>
            )}
            {actions && (
              <div className="flex gap-2">
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
      {description && (
        <div className="text-base leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
    </header>
  );
}
