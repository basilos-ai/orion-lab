import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeEvidence } from '@/components/common';
import { t, errorText } from '@/lib/i18n';
import { getLocale } from '@/lib/locale';
import { consumeEvents, requestError, StreamRequestError } from '@/lib/stream';
import { diagnosisPrompt, readGatewayEvidence, turnEvidence } from '@/lib/request-evidence';
import type { ReplyMeta } from '@/lib/types';

export function RequestDiagnosis({meta,disabled}:{meta?:ReplyMeta;disabled:boolean}) {
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[error,setError]=useState('');
  const [imported,setImported]=useState<ReturnType<typeof readGatewayEvidence>>(),[pending,setPending]=useState(false);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  const evidence=imported ?? turnEvidence(meta);
  const defaultQuestion=t('解释这次请求的结果，哪些原因可以从回执确认？');
  async function analyze() {
    if (!evidence || active.current) return;
    const controller=new AbortController();active.current=controller;setPending(true);setError('');setAnswer('');
    try {
      const response=await fetch('/api/chat',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({
        mode:'standard',scope:'local',max_tokens:480,messages:[{role:'user',content:diagnosisPrompt(question.trim() || defaultQuestion,evidence,getLocale()==='en-US')}]
      })});
      let done=false;
      await consumeEvents(response,event=>{
        if(event.event==='error') throw new StreamRequestError({code:event.code||'request_failed',error:event.error||''});
        if(event.event==='token') setAnswer(value=>value+(event.text||''));
        if(event.event==='done'){done=true;if(event.answer)setAnswer(event.answer);}
      });
      if(!done)throw new StreamRequestError({code:'stream_interrupted',error:''});
    } catch (err) {
      const detail=requestError(err);setAnswer('');setError(errorText(detail.error,detail.code));
    } finally {active.current=null;setPending(false);}
  }
  return <details className="execution-advanced"><summary>{t('AI 排障')}</summary>
    <p className="subtle">{t('用本地 9B 模型解释本轮回执。排查限额或发布版本时，可导入网关取证文件。')}</p>
    <label>{t('导入网关回执')}<input type="file" accept=".json" disabled={pending} onChange={async e=>{
      const file=e.target.files?.[0];e.target.value='';if(!file)return;
      setImported(undefined);setAnswer('');setError('');
      try{if(file.size>32000)throw Error();setImported(readGatewayEvidence(await file.text()));}
      catch{setError(t('文件格式或发布版本不匹配，请重新导出网关回执。'));}
    }}/></label>
    {imported&&<p>{t('使用导入请求 {0}',[String((imported.request as {request_id:string}).request_id)])} <Button variant="ghost" size="sm" disabled={pending} onClick={()=>{setImported(undefined);setAnswer('');setError('');}}>{t('移除')}</Button></p>}
    {evidence&&<CodeEvidence value={evidence} summary={t('查看排障依据')}/>}
    <label>{t('排障问题')}<textarea rows={2} maxLength={400} placeholder={defaultQuestion} value={question} disabled={pending} onChange={e=>setQuestion(e.target.value)}/></label>
    <Button size="sm" variant="outline" disabled={!evidence||disabled||pending} onClick={()=>void analyze()}>{pending?t('正在分析回执…'):t('分析请求')}</Button>
    {error&&<p role="alert">{error}</p>}{answer&&<p style={{whiteSpace:'pre-wrap'}}>{answer}</p>}
  </details>;
}
