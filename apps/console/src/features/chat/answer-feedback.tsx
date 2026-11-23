import { t } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Check, Copy, GitBranch, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useShell } from '@/components/app-shell';

export async function copyText(value:string) {
  if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);
  const input=document.createElement('textarea'),prior=document.activeElement as HTMLElement;input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();prior?.focus();if(!ok)throw new Error(t("浏览器未开放复制权限，请选中文本复制。"));
}

export function AnswerActions({text,onInspect,onRestore,restoreLabel=t("编辑后重发"),disabled=false}:{text:string;onInspect:()=>void;onRestore?:()=>void;restoreLabel?:string;disabled?:boolean}) {
  const [copied,setCopied]=useState(false),{notify}=useShell();
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1800);return()=>clearTimeout(timer);},[copied]);
  return <div className="answer-actions unified-answer-actions">{text&&<Button variant="ghost" size="sm" onClick={()=>void copyText(text).then(()=>{setCopied(true);notify(t("回答已复制。"));}).catch(e=>notify(e.message))}>{copied?<Check/>:<Copy/>}{copied?t("已复制"):t("复制")}</Button>}<Button variant="ghost" size="sm" onClick={onInspect}><GitBranch/>{t("执行详情")}</Button>{onRestore&&<Button variant="ghost" size="sm" disabled={disabled} onClick={onRestore}><PencilLine/>{restoreLabel}</Button>}</div>;
}

export function WaitingFeedback({label,startedAt}:{label:string;startedAt?:string}) {
  const [start]=useState(()=>Date.parse(startedAt||'')||Date.now()),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const seconds=Math.max(0,Math.floor((now-start)/1000));
  return <div className="answer-pending waiting-feedback"><div role="status"><span className="pending-dots" aria-hidden="true"><i/><i/><i/></span><span>{label}…</span></div><span className="waiting-elapsed" aria-hidden="true">{seconds}{t("秒")}</span>{seconds>=15&&<small>{t("任务仍在进行，你可以随时停止。")}</small>}</div>;
}
