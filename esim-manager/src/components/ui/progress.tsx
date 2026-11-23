import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

function Progress({ className, value, indeterminate, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root> & { indeterminate?: boolean }) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn('bg-primary/15 relative h-2 w-full overflow-hidden rounded-full', className)} value={indeterminate ? null : value} {...props}>
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('bg-primary h-full w-full flex-1 transition-all', indeterminate && 'animate-pulse')}
        style={{ transform: `translateX(-${100 - (indeterminate ? 100 : value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
