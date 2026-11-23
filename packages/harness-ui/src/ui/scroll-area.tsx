import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../lib/utils';

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
};

function ScrollBar({ className, orientation = 'vertical', ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none motion-reduce:transition-none! data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="bg-border relative flex-1 rounded-full" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

function ScrollArea({ className, viewportClassName, viewportRef, viewportProps, children, ...props }: ScrollAreaProps) {
  const { className: viewportPropsClassName, ref: viewportPropsRef, ...restViewportProps } = viewportProps ?? {};
  const mergedViewportRef = React.useMemo(() => {
    if (!viewportRef) return viewportPropsRef;
    if (!viewportPropsRef || viewportRef === viewportPropsRef) return viewportRef;
    return (node: HTMLDivElement | null) => {
      const refs = [viewportRef, viewportPropsRef];
      const cleanups = refs.map((ref) => {
        if (typeof ref === 'function') return ref(node);
        ref.current = node;
      });
      return () => {
        refs.forEach((ref, index) => {
          const cleanup = cleanups[index];
          if (typeof cleanup === 'function') cleanup();
          else if (typeof ref === 'function') ref(null);
          else ref.current = null;
        });
      };
    };
  }, [viewportRef, viewportPropsRef]);
  const childArray = React.Children.toArray(children);
  const scrollbarChildren = childArray.filter((child) => React.isValidElement(child) && child.type === ScrollBar);
  const viewportChildren = childArray.filter((child) => !(React.isValidElement(child) && child.type === ScrollBar));

  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative min-w-0 max-w-full overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={mergedViewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          'focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1 motion-reduce:transition-none! [&>div]:!block [&>div]:!w-full [&>div]:!min-w-0',
          viewportClassName,
          viewportPropsClassName,
        )}
        {...restViewportProps}
      >
        {viewportChildren}
      </ScrollAreaPrimitive.Viewport>
      {scrollbarChildren.length > 0 ? scrollbarChildren : <ScrollBar />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export { ScrollArea, ScrollBar };
