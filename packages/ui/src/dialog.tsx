import { Dialog as Primitive } from 'radix-ui';
import type {ComponentProps} from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { cn } from './lib/utils';
export const Dialog=Primitive.Root, DialogTrigger=Primitive.Trigger, DialogClose=Primitive.Close, DialogTitle=Primitive.Title, DialogDescription=Primitive.Description;
export function DialogContent({className,children,closeLabel='关闭',showCloseButton=true,...props}:ComponentProps<typeof Primitive.Content>&{closeLabel?:string;showCloseButton?:boolean}){return <Primitive.Portal><Primitive.Overlay data-slot="dialog-overlay" className="orion-dialog-overlay"/><Primitive.Content data-slot="dialog-content" className={cn('orion-dialog',className)} {...props}>{children}{showCloseButton&&<Primitive.Close asChild><Button data-slot="dialog-close" variant="ghost" size="icon-sm" className="orion-dialog-close" aria-label={closeLabel}><X/></Button></Primitive.Close>}</Primitive.Content></Primitive.Portal>;}
