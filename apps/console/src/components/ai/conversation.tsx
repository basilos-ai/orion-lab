import { t } from '@/lib/i18n';
/** Adapted from the user-supplied Harness AI Conversation composition. */
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { ArrowDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

export function Conversation(props: ComponentProps<typeof StickToBottom>) { return <StickToBottom className="messages-root" initial="smooth" resize="smooth" role="log" aria-label={t("对话消息")} {...props} />; }
export function ConversationContent(props: ComponentProps<typeof StickToBottom.Content>) { return <StickToBottom.Content className="messages" {...props} />; }
export function ConversationScrollButton() { const { isAtBottom, scrollToBottom } = useStickToBottomContext(); return !isAtBottom && <Button variant="outline" className="jump-latest" size="sm" onClick={() => scrollToBottom()} aria-label={t("跳至最新消息")}><ArrowDown />{t("最新消息")}</Button>; }
