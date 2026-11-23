/** Scoped Message / MessageContent / MessageActions adaptation from Harness AI elements. */
import type { HTMLAttributes } from 'react';
import { cn } from '@orion/ui/utils';
export function Message({ from, className, ...props }: HTMLAttributes<HTMLElement> & { from: 'user' | 'assistant' }) { return <article className={cn('message', from, className)} {...props} />; }
export function MessageContent(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cn('message-content', props.className)} />; }
export function MessageActions(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cn('answer-actions', props.className)} />; }
