import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from './lib/utils';
export type ButtonProps = React.ComponentProps<'button'> & { variant?: 'default'|'outline'|'secondary'|'ghost'|'destructive'|'link'; size?: 'default'|'xs'|'sm'|'lg'|'icon'|'icon-xs'|'icon-sm'|'icon-lg'; asChild?: boolean; loading?: boolean; loadingText?: React.ReactNode };
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant='default', size='default', asChild=false, className, disabled, children, loading=false, loadingText, ...props }, ref) {
 const Component = asChild ? Slot.Root : 'button';
 return <Component ref={ref} data-slot="button" data-variant={variant} data-size={size} disabled={disabled || loading} aria-disabled={disabled || loading || undefined} aria-busy={loading || undefined} className={cn('orion-button',className)} {...props}>{loading && loadingText ? loadingText : children}</Component>;
});
