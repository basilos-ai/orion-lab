import { t, localizedLabels } from '@/lib/i18n';
import { useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Cloud, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@orion/harness-ui/ui/popover';
import { Modal, SearchField, useMedia } from '@/components/common';
import { config } from '@/lib/config';
import type { Mode } from '@/lib/types';
import {decisionEngineNames as rawDecisionEngineNames, type DecisionEngine} from '@orion/contracts';
import { names, type useChat } from './use-chat';
type Chat=ReturnType<typeof useChat>;

export function ModelPicker({ c, hasImages, onChoose }: { c: Chat; hasImages: boolean; onChoose: (value: Mode) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const term=query.trim().toLocaleLowerCase();
  const mobile=useMedia('(max-width:760px)'),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),choice=useRef<Mode|null>(null);
  const groups: [string, Mode[]][] = [[t("自动"), ['auto']], [t("本地 · 常用"), ['small', 'standard', 'tiny']], [t("本地 · 专项与备用"), ['vision', 'large', 'cpu']], [t("云端 · 按量计费"), ['cloud']]];
  const label=c.mode==='auto'?`Auto · ${c.scope==='local'?t("仅本地"):t("允许云端")}`:(c.mode==='cloud'?'DeepSeek':names[c.mode]);
  function changeOpen(value:boolean){setOpen(value);if(value)setQuery('');}
  const button=<Button ref={trigger} type="button" variant="outline" className="model-button unified-model-button" title={label+(c.mode==='auto'?t(" · 决策 ")+decisionEngineNames[c.decisionEngine]:'')} disabled={c.busy} aria-label={t("选择回答模型，当前 {0}", [c.mode==='auto'?label:names[c.mode]])} aria-expanded={open} onClick={mobile?()=>changeOpen(true):undefined}><Sparkles/><span className="model-name">{label}</span><ChevronDown/></Button>;
  const menu=<div className="model-picker-body" ref={root} onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return;
    // Scope radios retain their native arrow-key semantics.
    if(!(event.target instanceof HTMLInputElement&&event.target.type==='search')&&!(event.target instanceof HTMLButtonElement&&event.target.getAttribute('role')==='option'))return;
    const buttons=[...root.current!.querySelectorAll<HTMLButtonElement>('[role=option]:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(event.target instanceof HTMLInputElement&&['Home','End'].includes(event.key))){event.preventDefault();if(!buttons.length)return;const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:index<0?event.key==='ArrowUp'?buttons.length-1:0:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();buttons[0]?.click();}
  }}>
    <div className="model-picker-search"><SearchField label={t("搜索回答模型")} value={query} onChange={setQuery} placeholder={t("搜索模型…")}/></div>
    <div className="model-picker-scroll">
      <div role="listbox" aria-label={t("回答模型")}>{groups.map(([group,modes])=>{
        const filtered=modes.filter(mode=>names[mode].toLocaleLowerCase().includes(term));
        return filtered.length>0&&<div role="group" aria-label={group} key={group}><p className={`menu-section ${modes.includes('auto')?'sr-only':''}`}>{group}</p>{filtered.map(mode=>{
          const incompatible=Boolean(hasImages&&!['auto','standard','vision'].includes(mode)||mode==='cloud'&&c.scope==='local'),configured=mode==='auto'||c.health?.models[mode]?.ready;
          const Icon=mode==='auto'?Sparkles:mode==='cloud'?Cloud:Cpu;
          return <button key={mode} type="button" role="option" aria-selected={mode===c.mode} disabled={incompatible||mode==='cloud'&&!c.authorized} className={`model-option ${mode===c.mode?'selected':''}`} onClick={()=>{choice.current=mode;onChoose(mode);changeOpen(false);}}><Icon className="model-option-icon" aria-hidden="true"/><span className="model-option-text">{names[mode]}<small>{mode==='auto'?c.toolMode?t("按任务自动选模，任务内锁定"):t("普通任务 4B，复杂任务 9B"):mode==='small'?t("后摩 · 仅对话"):mode==='tiny'?t("后摩 · 仅对话"):mode==='vision'?t("CPU · 图文，图片较慢"):mode==='cpu'?t("CPU · 仅对话备用"):mode==='standard'?t("后摩 · 问答与项目工具"):mode==='large'?t("后摩 · 仅对话，手动加载"):t("DeepSeek · 云端回答")}</small></span><span className="option-status">{mode===c.mode?<Check aria-label={t("已选择")}/>:incompatible?mode==='cloud'?t("仅本地已禁用"):t("不支持附件"):configured?null:config.demo?t("预览"):t("需加载")}</span></button>;
        })}</div>;
      })}{!Object.values(names).some(name=>name.toLocaleLowerCase().includes(term))&&<p className="empty">{t("没有匹配的模型")}</p>}</div>
      {c.mode==='auto'&&!term&&<DecisionEnginePicker chat={c}/>}
      {!term&&<ScopePicker value={c.scope} disabled={c.busy} onChange={c.setScope}/>}
    </div>
  </div>;
  return mobile?<>{button}<Modal open={open} onOpenChange={changeOpen} title={t("回答模型")} className="model-picker-dialog">{menu}</Modal></>:<Popover open={open} onOpenChange={changeOpen}><PopoverTrigger asChild>{button}</PopoverTrigger><PopoverContent side="top" align="end" sideOffset={8} collisionPadding={12} sticky="always" aria-label={t("选择回答模型")} className="model-popover model-picker-popover" onCloseAutoFocus={event=>{const mode=choice.current;choice.current=null;if(mode==='large'&&!c.health?.models.large.ready&&!config.demo)event.preventDefault();}} onOpenAutoFocus={event=>{event.preventDefault();root.current?.querySelector('input')?.focus();}}>{menu}</PopoverContent></Popover>;
}

function DecisionEnginePicker({chat:c}:{chat:Chat}) {
  return <fieldset className="decision-engine-picker" disabled={c.busy}><legend>{t("Auto 决策模型")}</legend><p className="decision-engine-help">{t("只负责判断任务，由 Auto 选择回答模型。")}</p><div>{(Object.entries(decisionEngineNames) as [DecisionEngine,string][]).map(([id,label])=>{
    const status=c.health?.decision_engines?.[id],available=config.demo||status?.available!==false;
    const state=status?.state==='loading'?t("准备中"):status?.state==='ready'?t("已加载"):status?.state==='unavailable'?t("暂不可用"):t("按需准备");
    return <label className={`decision-engine-option ${c.decisionEngine===id?'selected':''}`} key={id}><input type="radio" name="chat-decision-engine" value={id} checked={c.decisionEngine===id} disabled={!available} onChange={()=>c.setDecisionEngine(id)}/><span><strong>{label}</strong><small>{id==='laya'?t("CPU · 保留原有分类方式"):id==='qwen35-2b-houmo'?t("较快判决 · 与4B回答间需切换"):t("判决与4B回答共用服务，减少切换")}</small></span><span className="decision-engine-state">{config.demo?t("预览"):state}</span></label>;
  })}</div><p className="decision-engine-help">{c.toolMode&&c.scope==='local'?t("本地工具任务只有9B可用，跳过判决；允许云端后在9B和DeepSeek间选模。"):t("安全、能力与可用性规则优先；需要判决时使用所选模型。")}{t("首次使用后摩决策模型需准备数秒。")}</p></fieldset>;
}

function ScopePicker({value,disabled,onChange}:{value:'local'|'hybrid';disabled:boolean;onChange:(value:'local'|'hybrid')=>void}) {
  return <fieldset className="model-auto-scope" disabled={disabled}><legend>{t("调用范围")}</legend><div className="scope-segments">{([{id:'local',title:t("仅本地"),description:t("只使用本机回答模型，禁止调用云端。"),Icon:Cpu},{id:'hybrid',title:t("允许云端"),description:t("经审核的问题、必要历史、选定文件片段与获准工具结果可发送至 DeepSeek，按量计费。"),Icon:Cloud}] as const).map(({id,title,description,Icon})=><label className="scope-option" key={id}><input type="radio" name="chat-scope" checked={value===id} value={id} onChange={()=>onChange(id)}/><Icon aria-hidden="true"/><span><strong>{title}</strong><small className="sr-only">{description}</small></span></label>)}</div><p className="scope-explanation">{value==='hybrid'?t("经审核的问题、必要历史、选定文件片段和工具结果可发送至 DeepSeek，按量计费。"):t("只使用本机回答模型，禁止调用云端。")}</p></fieldset>;
}

const decisionEngineNames = localizedLabels(rawDecisionEngineNames);
