import { Popover as Primitive } from 'radix-ui';
import type {ComponentProps} from 'react';
import {cn} from './lib/utils';
export const Popover=Primitive.Root, PopoverTrigger=Primitive.Trigger, PopoverClose=Primitive.Close, PopoverAnchor=Primitive.Anchor;
export function PopoverContent({className,sideOffset=6,...props}:ComponentProps<typeof Primitive.Content>){return <Primitive.Portal><Primitive.Content data-slot="popover-content" sideOffset={sideOffset} className={cn('orion-popover',className)} {...props}/></Primitive.Portal>;}
