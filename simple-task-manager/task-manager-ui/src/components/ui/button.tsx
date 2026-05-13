import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-xs font-bold tracking-widest uppercase transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-primary text-primary bg-transparent hover:bg-primary hover:text-primary-foreground',
        destructive:
          'border border-destructive text-destructive bg-transparent hover:bg-destructive hover:text-destructive-foreground',
        outline:
          'border border-border bg-transparent text-foreground hover:border-primary hover:text-primary',
        ghost:
          'bg-transparent text-muted-foreground hover:text-primary',
      },
      size: {
        default: 'h-11 px-6',
        sm: 'h-9 px-4 text-2xs',
        lg: 'h-12 px-8',
        full: 'h-12 px-6 w-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
