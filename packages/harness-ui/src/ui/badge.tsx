import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '../lib/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit max-w-full shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-normal whitespace-nowrap transition-[color,background-color,border-color,box-shadow] motion-reduce:transition-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3! [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [&:is(a,button)]:hover:bg-primary/80',
        secondary: 'bg-secondary text-secondary-foreground [&:is(a,button)]:hover:bg-secondary/80',
        destructive:
          'bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [&:is(a,button)]:hover:bg-destructive/20',
        outline: 'border-border text-foreground [&:is(a,button)]:hover:bg-muted [&:is(a,button)]:hover:text-muted-foreground',
        info: 'border-info-border bg-info text-info-foreground [&:is(a,button)]:hover:bg-info/80',
        success: 'border-success-border bg-success text-success-foreground [&:is(a,button)]:hover:bg-success/80',
        warning: 'border-warning-border bg-warning text-warning-foreground [&:is(a,button)]:hover:bg-warning/80',
        error: 'border-error-border bg-error text-error-foreground [&:is(a,button)]:hover:bg-error/80',
        ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
