import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { XIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../ui/button';
import { CspModalOverlay, DialogState, useModalOpen, useModalRef } from '../lib/csp-modal';

/** Portal 内交互仍会冒泡到 document，表格编辑器的 click-away 会误判为“点击表格外”。 */
const stopDialogPointerPropagation = (event: React.SyntheticEvent) => {
  event.stopPropagation();
};

const mergePointerHandlers = <E extends React.SyntheticEvent>(
  isolationHandler: ((event: E) => void) | undefined,
  handler: ((event: E) => void) | undefined,
) => {
  if (!isolationHandler) {
    return handler;
  }

  return (event: E) => {
    isolationHandler(event);
    handler?.(event);
  };
};

function Dialog({ open: controlled, defaultOpen = false, onOpenChange, modal = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [open, change] = useModalOpen(controlled, defaultOpen, onOpenChange);
  return <DialogState.Provider value={{ open, modal }}><DialogPrimitive.Root data-slot="dialog" open={open} onOpenChange={change} modal={modal} {...props} /></DialogState.Provider>;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, forceMount: _forceMount, asChild: _asChild, contentRef, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay> & { contentRef?: React.RefObject<HTMLElement | null> }) {
  const { open, modal } = React.useContext(DialogState);
  if (!modal) return null;
  return (
    <CspModalOverlay open={open} contentRef={contentRef}
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 isolate z-50 bg-black/10 duration-200 data-[state=closed]:ease-in data-[state=open]:ease-out supports-backdrop-filter:backdrop-blur-xs motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  ref: forwardedRef,
  className,
  children,
  showCloseButton = true,
  isolatePointerEvents = false,
  overlayClassName,
  closeLabel = 'Close',
  onMouseDown,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /** 阻止弹窗内外指针事件冒泡，避免多维表网格 click-away 误关 Portal 弹窗 */
  isolatePointerEvents?: boolean;
  overlayClassName?: string;
  /** 内置关闭按钮的可访问名称，可由业务国际化替换。 */
  closeLabel?: string;
}) {
  const { contentRef, ref } = useModalRef<HTMLDivElement>(forwardedRef);
  const pointerIsolation = isolatePointerEvents ? stopDialogPointerPropagation : undefined;

  const overlay = <DialogOverlay contentRef={contentRef} className={cn(isolatePointerEvents && 'click-outside-ignore cursor-default', overlayClassName)} />;

  return (
    <DialogPortal>
      {isolatePointerEvents ? <DialogPrimitive.Close asChild>{overlay}</DialogPrimitive.Close> : overlay}
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          isolatePointerEvents && 'click-outside-ignore',
          showCloseButton && '[&>[data-slot=dialog-header]]:pr-8',
          'bg-popover text-popover-foreground ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-y-contain rounded-xl p-4 text-sm ring-1 duration-200 outline-none data-[state=closed]:ease-in data-[state=open]:ease-out motion-reduce:animate-none sm:max-w-sm',
          className,
        )}
        onMouseDown={mergePointerHandlers(pointerIsolation, onMouseDown)}
        onPointerDown={mergePointerHandlers(pointerIsolation, onPointerDown)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
              <XIcon aria-hidden="true" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex min-w-0 flex-col gap-2', className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  closeLabel = 'Close',
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
  /** 内置底部关闭按钮文案。 */
  closeLabel?: string;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('bg-muted/50 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t p-4 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{closeLabel}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-base leading-snug font-medium break-words', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3', className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
