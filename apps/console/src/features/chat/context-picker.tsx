import { t } from '@/lib/i18n';
import { useState } from 'react';
import { FileText, Folder, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@orion/harness-ui/ui/popover';
import type { useChat } from './use-chat';
export function ContextPicker({chat:c,open:controlledOpen,onOpenChange}:{chat:ReturnType<typeof useChat>;open?:boolean;onOpenChange?:(open:boolean)=>void}) {
  const [ownOpen,setOwnOpen]=useState(false),open=controlledOpen??ownOpen;
  const setOpen=onOpenChange??setOwnOpen;
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" className="context-button" disabled={c.busy} aria-label={t("添加上下文")} title={t("添加项目与文件上下文")}><Plus /></Button></PopoverTrigger><PopoverContent side="top" align="start" className="context-popover" aria-label={t("选择项目与文件")}><p className="menu-section">{t("项目空间")}</p>{(c.agentHealth?.projects||[]).map(p=><Button type="button" variant="ghost" key={p.id} aria-pressed={c.current.project===p.id} onClick={()=>void c.setProject(p.id)}><Folder /><span>{p.name}</span>{c.current.project===p.id&&<span>{t("已选择")}</span>}</Button>)}<Button variant="ghost" onClick={()=>{setOpen(false);c.setProjectDialog('create');}}><Plus/>{t("创建项目")}</Button><Button variant="ghost" onClick={()=>{setOpen(false);c.setProjectDialog('manage');}}><Folder/>{t("管理项目与文件")}</Button>{!c.agentHealth&&<p className="subtle">{t("项目服务连接中，稍后重试。")}</p>}{c.current.project&&<><p className="menu-section">{t("附加文件 · 已选")}{c.files.length} / 5</p><div className="context-files">{c.availableFiles.map(file=><label key={file}><input type="checkbox" checked={c.files.includes(file)} disabled={!c.files.includes(file)&&c.files.length>=5} onChange={e=>c.setFiles(e.target.checked?[...c.files,file]:c.files.filter(f=>f!==file))}/><FileText /><span>{file}</span></label>)}</div><Button type="button" variant="ghost" onClick={()=>{void c.setProject(null);setOpen(false);}}>{t("移除项目上下文")}</Button></>}<p className="menu-footnote">{t("Agent 默认只读；修改和检查前会请你逐次确认。")}</p></PopoverContent></Popover>;
}

export function ContextChips({chat:c}:{chat:ReturnType<typeof useChat>}) {
  if(!c.current.project&&!c.files.length)return null;
  return <div className="composer-context-row" aria-label={t("本轮项目与文件")}><span className="context-chip project-chip"><Folder /><span>{c.projects.find(p=>p.id===c.current.project)?.name||c.current.project}</span><button type="button" disabled={c.busy} aria-label={t("移除当前项目")} onClick={()=>void c.setProject(null)}><X /></button></span>{c.files.map(file=><span className="context-chip" key={file} title={file}><FileText /><span>{file}</span><button type="button" disabled={c.busy} aria-label={t("移除文件 {0}", [file])} onClick={()=>c.setFiles(c.files.filter(f=>f!==file))}><X /></button></span>)}</div>;
}
