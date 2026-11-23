import { sessionTitle } from '@/lib/session-title';
import { t } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Folder, MessageSquare, MoreHorizontal, Pencil, Plus, Search, SquarePen, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, SearchField } from '@/components/common';
import { Input } from '@orion/harness-ui/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@orion/harness-ui/ui/popover';
import { useShell } from '@/components/app-shell';
import { historyGroup, sessionTime } from '@/lib/chat-experience';
import { textContent } from '@/lib/stream';
import type { useChat } from './use-chat';
import { phaseNames } from '../agent/agent-turn';

type Chat = ReturnType<typeof useChat>;
export function ChatSidebar({chat:c,query,onQuery,onNew,onSelect}:{chat:Chat;query:string;onQuery:(q:string)=>void;onNew:()=>void;onSelect:(id:string)=>void}) {
  const [editing,setEditing]=useState<{id:string;title:string}|null>(null);
  const [menuId,setMenuId]=useState<string|null>(null);
  const searchRef=useRef<HTMLDivElement>(null),shell=useShell();
  const term=query.trim().toLocaleLowerCase();
  // Empty default placeholders are workspaces, not conversation history. Keep named
  // server summaries reachable while their messages have not been loaded yet.
  const history=c.sessions.filter(s=>s.messages.length||Boolean(s.title&&s.title!=='新对话'));
  const filtered=history.filter(s=>!term||s.title.toLocaleLowerCase().includes(term)||s.messages.some(m=>!m.excluded&&textContent(m.content).toLocaleLowerCase().includes(term))).map((item,index)=>({item,index,time:sessionTime(item,c.runs)})).sort((a,b)=>(b.time??0)-(a.time??0)||a.index-b.index).map(({item})=>item);
  const groups=[...c.projects.filter(p=>p.status!=='archived').map(p=>({label:p.name,project:p.id,items:filtered.filter(item=>(item.boundProject||item.project)===p.id)})),...[t("今天"),t("昨天"),t("更早"),t("其他对话")].map(label=>({label,project:undefined as string|undefined,items:filtered.filter(item=>!item.boundProject&&!item.project&&historyGroup(sessionTime(item,c.runs),new Date())===label)})).filter(g=>g.items.length)];
  function focusSearch(){if(!shell.navigationOpen)shell.toggleNavigation();requestAnimationFrame(()=>searchRef.current?.querySelector('input')?.focus());}
  useEffect(()=>{const focus=()=>focusSearch();addEventListener('orion-search-conversations',focus);return()=>removeEventListener('orion-search-conversations',focus);},[shell.navigationOpen]);
  useEffect(()=>{document.querySelector<HTMLElement>('#sessions [aria-current="page"]')?.scrollIntoView({block:'nearest'});},[c.current.id,shell.navigationOpen]);
  return <section className="session-section">
    <div className="sidebar-chat-actions"><Button variant="ghost" className="new-chat" aria-label={t("新建对话")} aria-keyshortcuts="Control+Shift+O Meta+Shift+O" title={t("新建对话 · Ctrl / ⌘ Shift O")} onClick={onNew}><SquarePen /><span>{t("新建对话")}</span></Button><Button variant="ghost" className="rail-search" aria-label={t("搜索对话记录")} title={t("搜索对话 · Ctrl / ⌘ K")} onClick={focusSearch}><Search /></Button></div>
    <div className="session-search" ref={searchRef} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onQuery('');(event.target as HTMLElement).blur();}if(event.key==='ArrowDown'){event.preventDefault();searchRef.current?.parentElement?.querySelector<HTMLElement>('#sessions button.session')?.focus();}}}><SearchField label={t("搜索对话")} value={query} onChange={onQuery} placeholder={t("搜索对话…")} /></div>
    <div className="section-label project-sidebar-label">{t("项目空间")}<div><Button variant="ghost" size="icon-sm" aria-label={t("管理项目空间")} title={t("管理项目空间")} onClick={()=>c.setProjectDialog('manage')}><Folder/></Button><Button variant="ghost" size="icon-sm" aria-label={t("创建项目空间")} title={t("创建项目空间")} onClick={()=>c.setProjectDialog('create')}><Plus/></Button></div></div><div className="section-label sr-only">{t("最近对话")}<span>{query?`${filtered.length} / ${history.length}`:history.length}</span></div>
    <nav id="sessions" aria-label={t("最近对话")}>{groups.map(group=><div className="session-group" key={group.label}><div className="session-group-label">{group.project?<><Button variant="ghost" className="project-group-title" onClick={()=>{c.openProject(group.project!);}}><Folder/><span>{group.label}</span></Button><Button variant="ghost" size="icon-sm" aria-label={t("在 {0} 新建对话", [group.label])} onClick={()=>c.createSession(group.project!)}><Plus/></Button></>:group.label}</div>{group.items.map((item,index)=>{
      const runId=[...item.messages].reverse().find(m=>m.runId)?.runId,run=runId?c.runs[runId]:undefined;
      const active=c.activeConversation===item.id&&c.busy;
      const Icon=run?Terminal:item.project?Folder:MessageSquare;
      return <div className="project-session-item" key={item.id}>{group.project&&(index===0||historyGroup(sessionTime(item,c.runs),new Date())!==historyGroup(sessionTime(group.items[index-1],c.runs),new Date()))&&<p className="session-group-label project-date-label">{historyGroup(sessionTime(item,c.runs),new Date())}</p>}<div className={`session-entry ${menuId===item.id?'menu-open':''}`} key={item.id}><Button variant="ghost" className={`session ${c.current.id===item.id?'active':''}`} title={sessionTitle(item)} data-conversation-id={item.id} aria-current={c.current.id===item.id?'page':undefined} onClick={()=>onSelect(item.id)}>
        <Icon aria-hidden="true" className="session-kind" /><span className="session-text"><span className="session-title">{sessionTitle(item)}</span><span className={`session-meta sr-only ${active?'session-running':''}`}>{active?(run?.phase==='awaiting_approval'?t("等待审批"):t("正在执行")):run?`Agent · ${phaseNames[run.phase]}`:item.project?t("项目问答"):t("对话")}</span></span>
        {active?<span className="session-activity" aria-label={t("进行中")}/>:null}
      </Button><Popover open={menuId===item.id} onOpenChange={open=>setMenuId(open?item.id:null)}><PopoverTrigger asChild><Button variant="ghost" size="icon-sm" className="session-more" aria-label={t("对话选项：{0}", [sessionTitle(item)])} title={t("对话选项")}><MoreHorizontal/></Button></PopoverTrigger><PopoverContent side="bottom" align="end" className="session-actions-menu" aria-label={t("会话选项")} onCloseAutoFocus={event=>{if(editing){event.preventDefault();}}}><Button variant="ghost" disabled={c.busy} onClick={()=>{setMenuId(null);requestAnimationFrame(()=>setEditing({id:item.id,title:sessionTitle(item)}));}}><Pencil/>{t("重命名对话")}</Button></PopoverContent></Popover></div></div>;
    })}</div>)}{!filtered.length&&<div className="session-empty"><p>{term?t("没有匹配的对话"):t("还没有对话记录")}</p>{term?<Button variant="ghost" size="sm" onClick={()=>onQuery('')}>{t("清除搜索")}</Button>:<p>{t("发送消息后会显示在这里")}</p>}</div>}</nav>
    <Modal open={Boolean(editing)} onOpenChange={open=>{if(!open)setEditing(null);}} title={t("重命名对话")} footer={<><Button variant="outline" onClick={()=>setEditing(null)}>{t("取消")}</Button><Button type="submit" form="session-rename-form">{t("保存名称")}</Button></>}><form id="session-rename-form" onSubmit={e=>{e.preventDefault();if(editing)c.rename(editing.title,editing.id);setEditing(null);}}><label className="setting-label" htmlFor="session-rename-input">{t("对话名称")}</label><Input id="session-rename-input" value={editing?.title||''} required maxLength={80} onChange={e=>setEditing(item=>item?{...item,title:e.target.value}:item)}/></form></Modal>
  </section>;
}
