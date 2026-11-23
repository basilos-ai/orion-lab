import * as React from 'react';
import { Slot } from 'radix-ui';
import { RemoveScroll } from 'react-remove-scroll';

type ModalState = { open: boolean; modal: boolean };
export const DialogState = React.createContext<ModalState>({ open: false, modal: true });
export const SheetState = React.createContext<ModalState>({ open: false, modal: true });

export function useModalOpen(open: boolean | undefined, defaultOpen: boolean, onChange?: (open: boolean) => void) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const change = React.useCallback((next: boolean) => {
    if (open === undefined) setInternal(next);
    onChange?.(next);
  }, [open, onChange]);
  return [open ?? internal, change] as const;
}

export function useModalRef<T extends HTMLElement>(forwarded: React.Ref<T> | undefined) {
  const contentRef = React.useRef<T | null>(null);
  const ref = React.useCallback<React.RefCallback<T>>(node => {
    contentRef.current = node;
    if (typeof forwarded === 'function') {
      const cleanup = forwarded(node);
      if (typeof cleanup === 'function') return () => { contentRef.current = null; cleanup(); };
    } else if (forwarded) forwarded.current = node;
  }, [forwarded]);
  return { contentRef, ref };
}

let locks = 0;
let restoreBody: (() => void) | undefined;
function useBodyScrollLock() {
  React.useLayoutEffect(() => {
    if (locks++ === 0) {
      const body = document.body;
      const properties = ['overflow', 'padding-right', '--removed-body-scroll-bar-size'];
      const previous = properties.map(property => [property, body.style.getPropertyValue(property), body.style.getPropertyPriority(property)]);
      const gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      const padding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      // CSSOM properties are CSP-compatible; do not create an inline style tag.
      body.style.setProperty('overflow', 'hidden', 'important');
      if (gap) body.style.setProperty('padding-right', `${padding + gap}px`);
      body.style.setProperty('--removed-body-scroll-bar-size', `${gap}px`);
      restoreBody = () => {
        for (const [property, value, priority] of previous) {
          if (value) body.style.setProperty(property, value, priority);
          else body.style.removeProperty(property);
        }
      };
    }
    return () => { if (--locks === 0) { restoreBody?.(); restoreBody = undefined; } };
  }, []);
}

/** Keep Radix focus/dismissal and RemoveScroll wheel isolation without runtime CSS injection. */
export function CspModalOverlay({ open, contentRef, style, ...props }: React.ComponentProps<'div'> & {
  open: boolean;
  contentRef?: React.RefObject<HTMLElement | null>;
}) {
  useBodyScrollLock();
  return <RemoveScroll as={Slot.Root} allowPinchZoom removeScrollBar={false} shards={contentRef ? [contentRef] : []}>
    <div {...props} data-state={open ? 'open' : 'closed'} style={{ pointerEvents: 'auto', ...style }} />
  </RemoveScroll>;
}
