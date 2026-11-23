import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

const alertVariants = cva(
  "group/alert relative grid w-full min-w-0 items-start gap-y-1 rounded-md border p-3 text-left text-sm leading-5 has-[>svg]:grid-cols-[auto_minmax(0,1fr)] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:mt-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: 'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
        info: 'border-info-border bg-info text-info-foreground *:data-[slot=alert-description]:text-info-foreground',
        success: 'border-success-border bg-success text-success-foreground *:data-[slot=alert-description]:text-success-foreground',
        warning: 'border-warning-border bg-warning text-warning-foreground *:data-[slot=alert-description]:text-warning-foreground',
        error: 'border-error-border bg-error text-error-foreground *:data-[slot=alert-description]:text-error-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" data-variant={variant ?? 'default'} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('min-w-0 font-medium break-words group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:opacity-80', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'min-w-0 text-muted-foreground text-sm text-pretty break-words group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:opacity-80 [&_p:not(:last-child)]:mb-2',
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-action" className={cn('mt-2 flex min-w-0 flex-wrap items-center gap-2 group-has-[>svg]/alert:col-start-2', className)} {...props} />;
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
