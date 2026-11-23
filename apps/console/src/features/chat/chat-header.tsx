import { sessionTitle } from '@/lib/session-title';
import { t } from '@/lib/i18n';
import { useRef, useState } from 'react';
import { ArrowDownToLine, Folder, MessageSquare, MoreHorizontal, PanelLeft, PanelRight, Pencil, Plus, Settings2 } from 'lucide-react';
import { useShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@orion/harness-ui/ui/badge';
import { Separator } from '@orion/harness-ui/ui/separator';
import { Input } from '@orion/harness-ui/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@orion/harness-ui/ui/popover';
import { Modal, useMedia } from '@/components/common';
import { downloadFile, safeFilename } from '@/lib/config';
import { textContent } from '@/lib/stream';
import type { useChat } from './use-chat';

type Chat = ReturnType<typeof useChat>;

export function ChatHeader({ chat, status, inspectorOpen, onToggleInspector, onNew }: { chat: Chat; status: string; inspectorOpen: boolean; onToggleInspector: () => void; onNew: () => void }) {
  const shell = useShell();
  const mobile = useMedia('(max-width:760px)');
  const connectionNeedsAttention=chat.connectionError||chat.sessionStatus==='denied'||chat.sessionStatus==='unavailable'||Boolean(chat.health?.benchmark)||chat.health?.switch.status==='loading'||Boolean(chat.health&&!chat.health.guard_ready);
  const [menuOpen, setMenuOpen] = useState(false), [renameOpen, setRenameOpen] = useState(false), [title, setTitle] = useState('');
  const trigger = useRef<HTMLButtonElement>(null), afterClose = useRef<(() => void) | null>(null);
  function closeThen(action: () => void) { afterClose.current = action; setMenuOpen(false); }
  function exportChat() {
    const parts = chat.current.messages.filter(message => !message.excluded).map(message => `### ${message.role === 'user' ? t("用户") : message.meta?.model || t("助手")}\n\n${textContent(message.content)}`);
    if (!parts.length) { shell.notify(t("当前没有可导出的已完成对话。")); return; }
    downloadFile(`${safeFilename(chat.current.title)}.md`, `# ${chat.current.title}\n\n${parts.join('\n\n')}\n`);
    shell.notify(t("已导出当前对话，排除未完成或被拒轮次。"));
  }
  return <>
    <header className="chat-header">
      {mobile&&<Button variant="ghost" size="icon" className="icon-button" aria-label={shell.navigationLabel} aria-expanded={shell.navigationOpen} onClick={shell.toggleNavigation}><PanelLeft /></Button>}
      <div className="chat-header-title"><h1 title={sessionTitle(chat.current)}>{sessionTitle(chat.current)}</h1><span>{chat.current.project?<><Folder />{chat.projects.find(p=>p.id===chat.current.project)?.name||chat.current.project}</>:<><MessageSquare />{t("统一对话工作区")}</>}</span></div>
      <div className="chat-header-actions">
        <Badge variant={connectionNeedsAttention?'warning':chat.authorized&&chat.health?.guard_ready?'success':'secondary'} className="chat-connection" role="status" aria-label={status}><i className={`status-dot ${chat.connectionError || !chat.authorized || !chat.health?.guard_ready ? 'unknown' : ''}`} /><span>{status}</span></Badge>
        <Button variant="ghost" size="sm" className="project-header-button" aria-label={t("选择或管理项目")} onClick={()=>chat.setProjectDialog('manage')}><Folder/><span>{t("项目")}</span></Button><Button variant="ghost" size="icon" className="icon-button chat-trace-toggle" aria-label={inspectorOpen ? t("关闭执行详情") : t("展开执行详情")} title={t("执行详情")} aria-expanded={inspectorOpen} onClick={onToggleInspector}><PanelRight /></Button>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><Button ref={trigger} variant="ghost" size="icon" className="icon-button" aria-label={t("对话操作")} title={t("对话操作")}><MoreHorizontal /></Button></PopoverTrigger><PopoverContent align="end" aria-label={t("对话操作")} className="chat-actions-menu" onCloseAutoFocus={event => {
          const action = afterClose.current;
          if (action) { event.preventDefault(); afterClose.current = null; trigger.current?.focus(); requestAnimationFrame(action); }
        }}>
          <p className="chat-menu-label">{t("当前对话")}</p>
          <Button variant="ghost" onClick={() => closeThen(onNew)}><Plus />{t("新建对话")}</Button>
          <Button variant="ghost" disabled={chat.busy} onClick={() => closeThen(() => { setTitle(sessionTitle(chat.current)); setRenameOpen(true); })}><Pencil />{t("重命名对话")}</Button>
          <Button variant="ghost" disabled={chat.busy} onClick={() => closeThen(exportChat)}><ArrowDownToLine />{t("导出为 Markdown")}</Button>
          <Separator className="chat-menu-divider" />
          <Button variant="ghost" onClick={() => closeThen(shell.settings)}><Settings2 />{t("外观与使用说明")}</Button>
        </PopoverContent></Popover>
      </div>
    </header>
    <Modal open={renameOpen} onOpenChange={setRenameOpen} title={t("重命名对话")} footer={<><Button variant="outline" onClick={() => setRenameOpen(false)}>{t("取消")}</Button><Button form="rename-form" type="submit">{t("保存名称")}</Button></>}><form id="rename-form" onSubmit={event => { event.preventDefault(); chat.rename(title); setRenameOpen(false); shell.notify(t("对话已重命名。")); }}><label className="setting-label" htmlFor="rename-input">{t("对话名称")}</label><Input id="rename-input" value={title} maxLength={80} required onChange={event => setTitle(event.target.value)} /></form></Modal>
  </>;
}
