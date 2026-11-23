import type {ComponentProps} from 'react';
import { Slot } from 'radix-ui';
import { cn } from './lib/utils';
export function Badge({variant='default',asChild=false,className,...props}:ComponentProps<'span'>&{variant?:'default'|'secondary'|'destructive'|'outline'|'info'|'success'|'warning'|'error'|'ghost'|'link';asChild?:boolean}){const Component=asChild?Slot.Root:'span';return <Component data-slot="badge" data-variant={variant} className={cn('orion-badge',className)} {...props}/>;}
