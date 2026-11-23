import { Dialog as SheetPrimitive } from 'radix-ui';
import * as React from 'react';

import { XIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../ui/button';
import { CspModalOverlay, SheetState, useModalOpen, useModalRef } from '../lib/csp-modal';

function Sheet({ open: controlled, defaultOpen = false, onOpenChange, modal = true, ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const [open, change] = useModalOpen(controlled, defaultOpen, onOpenChange);
  return <SheetState.Provider value={{ open, modal }}><SheetPrimitive.Root data-slot="sheet" open={open} onOpenChange={change} modal={modal} {...props} /></SheetState.Provider>;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, forceMount: _forceMount, asChild: _asChild, contentRef, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay> & { contentRef?: React.RefObject<HTMLElement | null> }) {
  const { open, modal } = React.useContext(SheetState);
  if (!modal) return null;
  return (
    <CspModalOverlay open={open} contentRef={contentRef}
      data-slot="sheet-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs motion-reduce:animate-none!',
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  ref: forwardedRef,
  className,
  children,
  side = 'right',
  showCloseButton = true,
  closeLabel = 'Close',
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
  /** 内置关闭按钮的可访问名称，可由业务国际化替换。 */
  closeLabel?: string;
}) {
  const { contentRef, ref } = useModalRef<HTMLDivElement>(forwardedRef);
  return (
    <SheetPortal>
      <SheetOverlay contentRef={contentRef} />
      <SheetPrimitive.Content
        ref={ref}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[side=bottom]:data-[state=open]:slide-in-from-bottom-10 data-[side=left]:data-[state=open]:slide-in-from-left-10 data-[side=right]:data-[state=open]:slide-in-from-right-10 data-[side=top]:data-[state=open]:slide-in-from-top-10 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[side=bottom]:data-[state=closed]:slide-out-to-bottom-10 data-[side=left]:data-[state=closed]:slide-out-to-left-10 data-[side=right]:data-[state=closed]:slide-out-to-right-10 data-[side=top]:data-[state=closed]:slide-out-to-top-10 fixed z-50 flex max-h-dvh min-w-0 flex-col gap-4 overflow-y-auto overscroll-y-contain bg-clip-padding text-sm shadow-lg duration-200 ease-in-out outline-none motion-reduce:animate-none! data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-dvh data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-dvh data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
          showCloseButton && '[&>[data-slot=sheet-header]]:pr-12',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
              <XIcon aria-hidden="true" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex min-w-0 shrink-0 flex-col gap-2 p-4', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-footer" className={cn('mt-auto flex min-w-0 shrink-0 flex-col gap-2 p-4', className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn('text-foreground text-base leading-snug font-medium break-words', className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn('text-muted-foreground min-w-0 break-words text-sm', className)} {...props} />;
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger };
