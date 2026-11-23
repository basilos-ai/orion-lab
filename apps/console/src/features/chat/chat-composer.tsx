import { t, localizedLabels, errorText } from '@/lib/i18n';
import { useRef, useState, type RefObject } from 'react';
import { ImagePlus, FileText, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@orion/harness-ui/ui/alert';
import { Kbd } from '@orion/harness-ui/ui/kbd';
import { PromptInput } from '@/components/ai/prompt-input';
import { PromptInputTools } from '@orion/harness-ui/ai/prompt-input';
import {decisionEngineNames as rawDecisionEngineNames} from '@orion/contracts';
import type { Mode, ReplyMeta } from '@/lib/types';
import { ModelPicker } from './chat-selectors';
import { PrivacyNotice } from './privacy-notice';
import { ContextPicker, ContextChips } from './context-picker';
import { type useChat } from './use-chat';

type Chat = ReturnType<typeof useChat>;
export function ChatComposer({chat:c,promptRef,onChoose,canSubmit=true,experienceActive=false}:{chat:Chat;promptRef:RefObject<HTMLTextAreaElement|null>;lastMeta?:ReplyMeta;onChoose:(model:Mode)=>void;canSubmit?:boolean;experienceActive?:boolean}) {
  const [contextOpen,setContextOpen]=useState(false);
  const imageInput=useRef<HTMLInputElement>(null),documentInput=useRef<HTMLInputElement>(null);
  const activeRun=c.agentHealth?.active?c.runs[c.agentHealth.active]:undefined;
  const awaiting=activeRun?.phase==='awaiting_approval';
  const currentLoading=c.mode!=='auto'&&c.mode!=='cloud'&&c.health?.switch.status==='loading';
  const projectArchived=Boolean(c.current.project&&c.projects.find(p=>p.id===c.current.project)?.status==='archived');
  const projectRequired=c.turnPlan.needsProject;
  const hasImages=Boolean(c.images.length||c.current.messages.some(m=>!m.excluded&&Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
  const cloud=c.scope==='hybrid'&&(c.mode==='cloud'||c.mode==='auto');
  const policy=cloud?t("含云端模型 · 按量计费"):c.mode==='vision'?t("CPU 图文 · 图片处理可能较慢"):c.toolMode?t("默认只读 · 修改和检查逐项确认"):t("本地处理");
  const disabledReason = c.hasDocuments&&hasImages?t("文档与图片问答请分开会话发送。"):c.documents.length&&c.files.length?t("文档问答请先移除已选项目文件。"):experienceActive?t("快速体验正在运行，完成或停止后可继续发送。"):projectArchived?t("项目已归档，请恢复后继续。"):projectRequired?t("访问项目文件前，请先选择项目。"):c.turnPlan.needsToolModel?t("当前模型仅支持对话；项目操作请切换 Auto 或 9B。"):c.turnPlan.imageTools?t("请先完成图片问答，再新建项目会话执行文件任务。"):c.mode==='cloud'&&c.scope==='local'?t("仅本地模式不调用云端，请先切换为允许云端。"):c.connectionError?t("设备连接中断，请检查连接。"):!c.authorized?c.sessionStatus==='denied'?t("此设备尚未获准发送消息。"):c.sessionStatus==='unavailable'?t("设备会话建立失败，请重新检查。"):t("正在连接设备…"):c.health?.benchmark?t("设备正在实测，完成后即可发送。"):currentLoading?t("模型正在加载，就绪后即可发送。"):c.toolMode&&!c.agentHealth?.ready?t("项目服务暂未就绪，请稍后重试。"):!canSubmit?t("请先完成模型选择。"):'';
  const imageReason=!['auto','standard','vision'].includes(c.mode)?t("请先选择 MiniCPM-V、9B 或 Auto"):c.health?.image_safety!=='local_screen_block'?t("图片审核服务尚未开放"):'';
  const submitDisabled = (!c.text.trim()&&!c.images.length&&!c.documents.length)||Boolean(disabledReason);
  return <div className="composer-wrap" data-composer-state={c.busy ? 'streaming' : disabledReason ? 'unavailable' : 'ready'}>
    {!c.authorized && (c.sessionStatus === 'denied' || c.sessionStatus === 'unavailable') && <Alert variant="warning" role="status" className="chat-access-notice"><ShieldCheck aria-hidden="true" /><AlertTitle>{c.sessionStatus === 'denied' ? t("此设备尚未获得聊天权限") : t("暂时无法建立设备会话")}</AlertTitle><AlertDescription id="composer-guidance">{c.sessionStatus === 'denied' ? t("仍可查看已有对话和编辑草稿。请联系设备管理员授权，然后重新检查。") : t("请检查设备连接后重试，输入的草稿会保留。")}</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={() => void c.refreshSession()}>{t("重新检查权限")}</Button></AlertAction></Alert>}
    {c.busy&&c.activeConversation!==c.current.id&&<div className="global-activity" role="status"><span>{t("另一会话正在执行，结束后可发送新消息。")}</span><Button variant="ghost" size="sm" onClick={()=>c.activeConversation&&c.chooseSession(c.activeConversation)}>{t("返回执行中的会话")}</Button></div>}
    {c.busy&&(awaiting||c.cancelPending)&&<div className={`composer-activity ${awaiting?'needs-approval':''}`}><div className="live-status active" role="status">{awaiting?<ShieldCheck/>:<LoaderCircle className="activity-spinner"/>}{c.cancelPending?t("正在停止…"):t("等待你的确认")}</div>{awaiting&&c.activeConversation===c.current.id?<Button type="button" variant="ghost" size="sm" onClick={()=>{const region=document.querySelector<HTMLElement>('.agent-approval');region?.focus();region?.scrollIntoView({block:'center',behavior:'smooth'});}}>{t("查看待审批操作")}</Button>:null}</div>}
    <PromptInput value={c.text} onChange={c.setText} inputRef={promptRef}
      submitDisabled={submitDisabled} disabledReason={disabledReason} loading={c.busy} onSubmit={()=>void c.send()} onStop={()=>void c.stop()} cancelPending={c.cancelPending}
      placeholder={c.current.project?t("询问这个项目，或描述你想完成的任务…"):t("直接提问、添加图片，或选择项目开始工作…")}
      onUnsupportedFiles={()=>c.setNotice(imageReason||t("请使用添加图片按钮或粘贴 PNG、JPEG、WebP。"))}
      onImageFiles={!imageReason?files=>void c.addFiles(files):undefined}
      header={c.current.project||c.images.length||c.documents.length?<><ContextChips chat={c}/>
      {c.documents.length>0&&<div className="document-attachments" aria-label={t("待发送文档")}>{c.documents.map((file,i)=><div className="document-attachment" key={file.name+':'+i}><FileText aria-hidden="true"/><span><strong>{file.name}</strong><small>{(file.size/1024).toFixed(1)}{t("KiB · 发送时提取并审核文字")}</small></span><Button type="button" variant="ghost" size="icon-sm" aria-label={t("移除文档 ")+file.name} disabled={c.busy} onClick={()=>c.setDocuments(c.documents.filter((_,n)=>n!==i))}><X/></Button></div>)}<small>{t("仅提取可读取文字，不识别扫描页和图片文字。")}</small></div>}
      {c.images.length>0&&<div className="attachments">{c.images.map((url,i)=><div className="attachment" key={url}><img src={url} alt={t("待发送图片 {0}", [i+1])}/><button type="button" aria-label={t("移除图片 {0}", [i+1])} onClick={()=>c.setImages(c.images.filter((_,n)=>n!==i))}><X/></button></div>)}</div>}</>:undefined}
      footer={sendButton=><div className="harness-toolbar"><PromptInputTools className="harness-tools"><ContextPicker chat={c} open={contextOpen} onOpenChange={setContextOpen}/><Button type="button" variant="ghost" size="icon-sm" aria-label={t("添加文档")} title={t("PDF / DOCX · 仅提取文字")} disabled={c.busy||hasImages} onClick={()=>documentInput.current?.click()}><FileText/></Button><input ref={documentInput} type="file" hidden multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label={t("选择文档文件")} onChange={event=>{if(event.target.files)c.addDocuments(event.target.files);event.target.value='';}}/><Button type="button" variant="ghost" size="icon-sm" aria-label={t("添加图片")} title={imageReason||t("添加图片 · 仅在本地审核与处理")} disabled={c.busy||c.hasDocuments||Boolean(imageReason)} onClick={()=>imageInput.current?.click()}><ImagePlus/></Button><input ref={imageInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label={t("选择图片文件")} onChange={event=>{if(event.target.files)void c.addFiles(event.target.files);event.target.value='';}}/></PromptInputTools><div className="harness-actions"><ModelPicker c={c} hasImages={hasImages} onChoose={onChoose}/><PrivacyNotice scope={c.scope} mode={c.mode} health={c.health} hasImages={hasImages}/>{sendButton}</div></div>}
    />
    {disabledReason&&c.sessionStatus!=='denied'&&c.sessionStatus!=='unavailable'&&<div className="composer-guidance" id="composer-guidance" role="status"><span>{disabledReason}</span>{projectArchived&&<Button variant="ghost" size="sm" onClick={()=>c.setProjectDialog('manage')}>{t("管理项目")}</Button>}{projectRequired&&<Button variant="ghost" size="sm" disabled={c.busy} onClick={()=>setContextOpen(true)}>{t("选择项目")}</Button>}</div>}
    {c.turnPlan.needsToolModel&&!c.busy&&<Button variant="outline" size="sm" onClick={()=>c.setMode('standard')}>{t("切换 9B 并保留草稿")}</Button>}
    <div className="prompt-caption"><div className="prompt-context"><span>{policy}{c.mode==='auto'&&<span className="decision-caption">{t("· 决策：")}{decisionEngineNames[c.decisionEngine]}</span>}</span></div><span className="prompt-shortcut"><Kbd>Enter</Kbd>{t("发送")}<span>·</span><Kbd>Shift Enter</Kbd>{t("换行")}</span></div>
    {c.notice&&<Alert variant="info" className="notice composer-notice" role="status"><AlertDescription>{errorText(c.notice)}</AlertDescription><Button variant="ghost" size="icon-sm" aria-label={t("关闭提示")} onClick={()=>c.setNotice('')}><X/></Button></Alert>}{c.connectionError&&<Button variant="ghost" size="sm" className="connection-retry" onClick={()=>void c.refreshHealth()}>{t("连接中断，重新检查")}</Button>}
  </div>;
}

const decisionEngineNames = localizedLabels(rawDecisionEngineNames);
