import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '../lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-normal whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-loading:disabled:opacity-100 data-loading:aria-disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 motion-reduce:transition-none motion-reduce:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary no-underline decoration-current underline-offset-4 hover:text-primary/80 hover:underline focus-visible:underline active:underline',
      },
      size: {
        default: 'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs': "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-md',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    loadingText?: React.ReactNode;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', asChild = false, loading = false, loadingText, disabled, children, onClick, onClickCapture, onKeyDown, tabIndex, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  const inactive = Boolean(disabled || loading || props['aria-disabled'] === true || props['aria-disabled'] === 'true');
  const blockActivation = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  let slottedChild = children;
  if (asChild && React.isValidElement<React.HTMLAttributes<HTMLElement>>(children)) {
    const child = children;
    slottedChild = React.cloneElement(child, {
      ...(loading && loadingText !== undefined ? { children: loadingText } : {}),
      ...(inactive ? {
        'aria-disabled': true,
        tabIndex: -1,
        onClick: blockActivation,
        onClickCapture: blockActivation,
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter' || event.key === ' ') blockActivation(event);
          else child.props.onKeyDown?.(event);
        },
      } : {}),
    });
  }

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy']}
      aria-disabled={inactive || props['aria-disabled']}
      data-loading={loading || undefined}
      tabIndex={asChild && inactive ? -1 : tabIndex}
      onClick={(event) => { if (inactive) blockActivation(event); else onClick?.(event); }}
      onClickCapture={(event) => { if (inactive) blockActivation(event); else onClickCapture?.(event); }}
      onKeyDown={(event) => {
        if (inactive && (event.key === 'Enter' || event.key === ' ')) blockActivation(event);
        else onKeyDown?.(event);
      }}
    >
      {asChild && loading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {asChild ? <Slot.Slottable>{slottedChild}</Slot.Slottable> : (
        <span data-slot="button-content" className="relative inline-grid place-items-center gap-[inherit]">
          <span
            className={cn('col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]', loading && 'opacity-0')}
            aria-hidden={loading && loadingText !== undefined ? true : undefined}
          >{children}</span>
          {(loading || loadingText !== undefined) && (
            <span
              data-slot="button-loading"
              className={cn('col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]', loadingText === undefined && 'absolute inset-0', !loading && 'invisible')}
              aria-hidden={!loading || loadingText === undefined ? true : undefined}
            >
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {loadingText}
            </span>
          )}
        </span>
      )}
    </Comp>
  );
});

export { Button, buttonVariants };
