import { forwardRef } from 'react';
import { Button as BasilosButton, type ButtonProps } from '@orion/harness-ui/ui/button';

/** Official V2 Button via its supported slot API; retain host child structure and refs. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ asChild, children, ...props }, ref) {
  if (asChild) return <BasilosButton ref={ref} asChild {...props}>{children}</BasilosButton>;
  return <BasilosButton ref={ref} asChild {...props}><button>{children}</button></BasilosButton>;
});
export type { ButtonProps };
