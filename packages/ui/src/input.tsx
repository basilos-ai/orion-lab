import * as React from 'react';
import { cn } from './lib/utils';
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function Input({className,...props},ref){return <input ref={ref} data-slot="input" className={cn('orion-input',className)} {...props}/>;});
