'use client';

import { Progress as ProgressPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../lib/utils';

function Progress({ className, value, max, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  // Match the installed Radix Root validation so the visual value and ARIA state
  // agree, including invalid ranges and the distinction between zero and unknown.
  const normalizedMax = typeof max === 'number' && !Number.isNaN(max) && max > 0 ? max : 100;
  const normalizedValue = typeof value === 'number' && !Number.isNaN(value) && value >= 0 && value <= normalizedMax ? value : null;
  const percentage = normalizedValue === null ? null : normalizedValue === normalizedMax ? 100 : normalizedValue / normalizedMax * 100;

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn('bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'bg-primary h-full rounded-full transition-transform duration-300 motion-reduce:transition-none!',
          percentage === null ? 'mx-auto w-1/3 flex-none animate-pulse motion-reduce:animate-none!' : 'w-full flex-1',
        )}
        style={{ transform: percentage === null ? undefined : `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
