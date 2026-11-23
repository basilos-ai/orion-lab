import { t, errorText } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/common';
import { consumeEvents } from '@/lib/stream';
import type { DecisionEngine, ReplyMeta, StreamEvent } from '@/lib/types';
import { TurnFeedback } from './turn-feedback';

type Tab = 'routing'|'input'|'output';
type Scenario = 'simple'|'complex'|'input'|'output';
type Result = { meta:ReplyMeta; answer:string; phase:'running'|'done'|'failed'; error?:string; selfTest?:boolean; receipt?:string };
const scenarios = {
  simple: {get title() { return t("简单任务"); },get prompt() { return t("计算23+47"); },tokens:48},
  complex: {get title() { return t("复杂任务"); },get prompt() { return t("请分步计算：商品原价200元，先打八折，再减30元优惠券，最后加12元运费。请用不超过80字列出三步算式和最终实付金额。"); },tokens:256},
  input: {get title() { return t("输入拦截"); },get prompt() { return t("这是一条安全保护体验，所有内容均为虚构测试材料：api_key=ORION_DEMO_NOT_A_REAL_CREDENTIAL。请说明这条材料。"); },tokens:32},
};

export function QuickExperience({canRun,decisionEngine,onBusy}:{canRun:boolean;decisionEngine:DecisionEngine;onBusy:(value:boolean)=>void}) {
  const [tab,setTab]=useState<Tab|null>(null),[running,setRunning]=useState<Scenario|null>(null),[results,setResults]=useState<Partial<Record<Scenario,Result>>>({});
  const controller=useRef<AbortController|null>(null),busyRef=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  function close(){controller.current?.abort();setTab(null);}
  async function run(id:Scenario){
    if(busyRef.current||!canRun)return;
    busyRef.current=true;onBusy(true);setRunning(id);const abort=new AbortController();controller.current=abort;
    const result:Result={meta:{mode:id==='input'?'small':'auto',scope:'local',stages:[]},answer:'',phase:'running'};
    const paint=()=>{if(mounted.current)setResults(old=>({...old,[id]:{...result,meta:{...result.meta,stages:[...(result.meta.stages||[])]}}}));};paint();
    try {
      if(id==='output'){
        const response=await fetch('/api/agent/experiences/output',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:abort.signal});
        const data=await response.json();if(!response.ok)throw new Error(t("输出保护自检服务暂不可用，请稍后重试。"));
        if(data.kind!=='synthetic_output_self_test'||data.scope!=='project_output'||data.model_called!==false||data.semantic_review!==false||data.passed!==true||data.safe_passed!==true||data.blocked!==true||data.sensitive_visible!==false)throw new Error(t("输出保护自检未通过或回执不完整，未将本次结果标为成功。"));
        result.selfTest=true;result.receipt=data.tested_at;result.phase='done';paint();
      }else{
        const scenario=scenarios[id];let terminal=false;
        const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({messages:[{role:'user',content:scenario.prompt}],mode:id==='input'?'small':'auto',scope:'local',decision_engine:decisionEngine,max_tokens:scenario.tokens})});
        await consumeEvents(response,(event:StreamEvent)=>{
          if(event.event==='accepted'||event.event==='decision')result.meta={...result.meta,...event};
          if(event.event==='stage'&&event.stage)result.meta.stages=[...(result.meta.stages||[]),{stage:event.stage,created:event.created}];
          if(event.event==='token')result.answer+=event.text||'';
          if(event.event==='done'){terminal=true;result.answer=event.answer??result.answer;result.meta={...result.meta,...event,stages:[...(event.stages||result.meta.stages||[]),{stage:'completed'}]};result.phase=event.finish_reason==='length'?'failed':'done';if(event.finish_reason==='length')result.error=t("回答达到输出长度上限，以下为实际片段，可重试体验。");else if(id==='input')result.error=t("本次输入未被拦截，以下展示实际结果。");}
          if(event.event==='error'){terminal=true;result.meta={...result.meta,...event,error:{code:event.code||'request_failed',error:event.error||t("体验未完成"),reason_code:event.reason_code}};result.phase=id==='input'&&event.code==='input_blocked'?'done':'failed';if(result.phase==='failed')result.error=event.error||t("体验未完成，请重试。");}
          paint();
        });
        if(!terminal)throw new Error(t("连接提前结束，体验未完成。"));
      }
    }catch(error){result.phase='failed';result.error=abort.signal.aborted?t("已停止体验。设备可能仍在结束本次请求。"):error instanceof Error?error.message:t("体验未完成，请重试。");paint();}
    finally{busyRef.current=false;controller.current=null;onBusy(false);if(mounted.current)setRunning(null);}
  }
  function outcome(id:Scenario){
    const result=results[id];if(!result)return null;
    return <div className="experience-result" role="group" aria-label={t("{0}体验结果", [id==='output'?t("输出保护"):scenarios[id].title])}>
      {result.phase==='running'&&<p className="experience-progress" role="status"><LoaderCircle aria-hidden="true"/>{t("正在")}{result.meta.stages?.some(e=>e.stage==='generating')?t("生成回答"):result.meta.stages?.some(e=>e.stage==='input_checking')?t("检查输入"):t("处理体验")}{t("…首次加载模型可能需要等待。")}</p>}
      {id==='output'?result.selfTest&&<div className="output-self-test-receipt"><strong>{t("项目敏感输出已拦截")}</strong><p>{t("正常文本放行；分段出现的虚构凭据被检查器阻断，敏感内容未展示。")}</p><p>{t("固定合成输出自检 · 未调用回答模型 · 未启用完整语义输出审核")}</p><small>{t("检查器：project_sensitive_patterns_v1 ·")}{result.receipt}</small></div>:<><TurnFeedback meta={result.meta}/>{result.meta.error?.code==='input_blocked'&&<p className="experience-block-result" role="status">{t("已拦截虚构凭据，未调用回答模型。")}</p>}{result.answer&&<pre tabIndex={0} aria-label={t("体验模型回答")}>{result.answer}</pre>}</>}
      {result.error&&<p className="notice" role="status">{errorText(result.error)}</p>}
    </div>;
  }
  return <>
    <div className="quick-experience-entry"><p>{t("了解自动选模与安全保护如何工作")}</p><div><Button variant="ghost" size="sm" onClick={()=>setTab('routing')}><Sparkles aria-hidden="true"/>{t("体验自动选模")}</Button><Button variant="ghost" size="sm" onClick={()=>setTab('input')}><ShieldCheck aria-hidden="true"/>{t("体验安全保护")}</Button></div></div>
    <Modal open={Boolean(tab)} onOpenChange={value=>{if(!value)close();}} title={t("快速体验")} description={t("独立体验，仅使用下方虚构材料；不读取当前对话或项目，不改动草稿与模型设置。真实模型体验仅在本地运行。")} className="quick-experience-dialog" contentLabel={t("快速体验内容")} footer={<>{running&&<Button variant="outline" onClick={()=>controller.current?.abort()}>{t("停止体验")}</Button>}<Button variant="outline" onClick={close}>{running?t("停止并关闭"):t("关闭体验")}</Button></>}>
      <div className="experience-tabs" role="group" aria-label={t("体验类型")}>{([['routing',t("自动选模")],['input',t("输入拦截")],['output',t("输出保护自检")]] as const).map(([id,label])=><Button key={id} variant={tab===id?'secondary':'ghost'} size="sm" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</Button>)}</div>
      {!canRun&&!running&&<p className="notice" role="status">{t("设备正在处理任务或尚未连接，请稍后运行体验。")}</p>}
      {tab==='routing'&&<section aria-label={t("自动选模体验")}><h3>{t("同样使用 Auto，比较不同任务的实际选择")}</h3><p className="subtle">{t("两次请求各自不带历史。选择结果受任务复杂度和模型可用性影响；规则直接命中时不会额外运行决策模型。")}</p>{(['simple','complex'] as const).map(id=><div className="experience-scenario" key={id}><h4>{scenarios[id].title}</h4><p>{scenarios[id].prompt}</p><Button variant="outline" disabled={!canRun||Boolean(running)} onClick={()=>void run(id)}>{t("运行")}{scenarios[id].title}</Button>{outcome(id)}</div>)}</section>}
      {tab==='input'&&<section aria-label={t("输入拦截体验")}><h3>{t("体验敏感输入在回答前被拦截")}</h3><p>{t("提交固定的虚构凭据材料，经过当前真实输入保护链路。命中后会显示拦截结果，不产生模型回答。")}</p><pre className="experience-sample" tabIndex={0}>api_key=ORION_DEMO_NOT_A_REAL_CREDENTIAL</pre><p className="subtle">{t("以上仅为虚构测试值。此体验手动指定本地模型，跳过自动选模。")}</p><Button variant="outline" disabled={!canRun||Boolean(running)} onClick={()=>void run('input')}>{t("运行输入拦截体验")}</Button>{outcome('input')}</section>}
      {tab==='output'&&<section aria-label={t("输出保护自检")}><h3>{t("体验项目敏感输出检查")}</h3><p>{t("后台将固定的正常文本和含虚构凭据的分段候选输出送入项目任务使用的同一个检查器，验证正常放行与敏感阻断。")}</p><p className="experience-scope">{t("保护范围：项目任务中的凭据等敏感模式检查。普通聊天未启用输出审核；项目任务也未启用完整语义输出审核。")}</p><p className="subtle">{t("这是合成输出自检，不调用回答模型，也不表示某个模型生成了敏感内容。")}</p><Button variant="outline" disabled={!canRun||Boolean(running)} onClick={()=>void run('output')}>{t("运行输出保护自检")}</Button>{outcome('output')}</section>}
    </Modal>
  </>;
}
