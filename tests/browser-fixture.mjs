import { legacyGatewayName } from '../apps/console/src/lib/gateway-brand.ts';

/** UI protocol fixture. It never calls a model or executes a tool. */
export function fixtureApi() {
  let failHealth = false, largeReady=true, chatCalls = 0, selfTestCalls=0, failOutputSelfTest=false, truncateExperience=false, lastChat,lastAgent; const conversations=new Map();
  const now = () => new Date().toISOString();
  const event = (seq, type, data) => ({seq, type, data, at:now()});
  const runs = Array.from({length:40},(_,i)=>({id:'history-'+i,project:'demo',model:'auto',access:'read',selected:'standard',phase:'completed',created:now(),events:[event(1,'answer',{text:'历史任务 '+i})]}));
  const health = {ready:true,nativeHooks:false,hookMode:'policy_bridge',explanation:'Pi 事件由安全策略桥接审核；不登记到 AI Gateway 原生 Agent Hooks 页。',projects:[{id:'demo',name:'沙盒项目'}],models:[{id:'auto',label:'Auto · Laya 动态选模'},{id:'standard',label:'Qwen3.5-9B · 后摩'},{id:'cloud',label:'DeepSeek · 云端'}]};
  return {
    streamHTTP(req,res,id) {
      const r=runs.find(run=>run.id===id);if(!r){res.writeHead(404);res.end('{}');return;}
      res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
      const send=frame=>res.write(JSON.stringify(frame)+'\n');let seq=r.events.at(-1)?.seq||0,lastPhase=r.phase;
      send({event:'snapshot',run:r});if(['completed','cancelled','failed','blocked'].includes(r.phase)){res.end();return;}
      const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}for(const entry of r.events.filter(e=>e.seq>seq)){const {events,...meta}=r;send({event:'entry',entry,run:meta});seq=entry.seq;}if(lastPhase!==r.phase){send({event:'snapshot',run:r});lastPhase=r.phase;}if(['completed','cancelled','failed','blocked'].includes(r.phase)){clearInterval(timer);res.end();}},30);
      res.on('close',()=>clearInterval(timer));
    },
    set truncateExperience(value){truncateExperience=value;},get selfTestCalls(){return selfTestCalls;},set failOutputSelfTest(value){failOutputSelfTest=value;},
    runs, conversations, set largeReady(value){largeReady=value;}, get chatCalls() {return chatCalls;}, get lastChat(){return lastChat;}, get lastAgent(){return lastAgent;}, set failHealth(value) {failHealth=value;},
    async handle(route) {
      const req=route.request(), url=new URL(req.url()), p=url.pathname;
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(p==='/api/session') return json({authorized:true});
      if(p==='/api/documents') {
        const name=url.searchParams.get('name');
        if(name==='empty.pdf')return json({code:'document_no_text'},400);
        return json({id:'d'.repeat(32),name,bytes:100,characters:42,pages:name?.endsWith('.pdf')?1:null,sha256:'f'.repeat(64)});
      }
      if(p==='/api/health') return json({version:'fixture',guard_ready:true,busy:false,benchmark:false,models:Object.fromEntries(['small','tiny','standard','vision','cpu','large','cloud'].map(id=>[id,{label:id,ready:id==='large'?largeReady:true}])),switch:{status:'ready'},input_mode:'block',image_safety:'local_screen_block'});
      if(p==='/api/agent/health') return json(failHealth?{code:'agent_unavailable'}:{...health,active:runs.find(r=>['running','checking','awaiting_approval'].includes(r.phase))?.id},failHealth?503:200);
      if(p==='/api/agent/files')return json({files:['README.md','demo.py']});
      if(p==='/api/agent/projects')return json({projects:health.projects});
      if(p==='/api/agent/projects/demo/files')return json({files:['README.md','demo.py'],entries:[{path:'README.md',kind:'file',bytes:15},{path:'demo.py',kind:'file',bytes:8}],limits:{files:200,bytes:1048576,fileBytes:32768,depth:5},truncated:false});
      if(p==='/api/agent/conversations'){if(req.method()==='GET')return json({conversations:[...conversations.values()].map(c=>({id:c.id,project:c.project,title:'新对话'}))});const b=req.postDataJSON();if(!conversations.has(b.id))conversations.set(b.id,{id:b.id,project:null,turns:[],runIds:[],context:[]});if(b.project)conversations.get(b.id).project=b.project;return json(conversations.get(b.id));}
      if(p.startsWith('/api/agent/conversations/'))return json(conversations.get(p.split('/').at(-1))||{code:'not_found'},conversations.has(p.split('/').at(-1))?200:404);
      if(p==='/api/agent/runs' && req.method()==='GET') return json({runs});
      if(p.endsWith('/events')&&p.startsWith('/api/agent/runs/'))return route.continue();
      if(p==='/api/agent/runs') {
        const body=req.postDataJSON();lastAgent=body;if(body.model==='cloud'&&body.scope!=='hybrid')return json({code:'cloud_scope_required'},400);if(body.prompt==='ADMISSION_FAIL')return json({code:'device_busy'},409);
        const approval=body.prompt.includes('APPROVAL'), blocked=body.prompt.includes('BLOCK');
        const r={id:'fixture-'+runs.length,conversationId:body.conversationId,turnId:body.turnId,files:body.files,project:'demo',model:body.model,scope:body.scope,access:body.access,selected:blocked?'':body.scope==='hybrid'&&(body.model==='cloud'||body.prompt.includes('COMPLEX'))?'cloud':'standard',phase:blocked?'blocked':approval?'awaiting_approval':'running',created:now(),events:[]};
        if(blocked) r.events.push(event(1,'error',{code:'policy_blocked'}));
        else r.events.push(event(1,'hook',{stage:'UserPromptSubmit',verdict:'allow',mode:'policy_bridge',elapsed_ms:1}),event(2,'prompt',{text:body.prompt}));
        if(approval) {r.approval={id:'approval-'+r.id,tool:'write_file',digest:'fixture-digest',summary:'修改 demo.py',file:'demo.py',before:'print(1)',after:'print(2)',preview:'--- 当前\nprint(1)\n+++ 建议\nprint(2)',expiresAt:new Date(Date.now()+90000).toISOString()};r.events.push(event(3,'tool_start',{id:'fixture-write',tool:'write_file',args:{path:'demo.py',content:'print(2)'}}),event(4,'approval',{...r.approval}));}
        r.wait=body.prompt.includes('WAIT'); runs.unshift(r);
        if(body.prompt.includes('STREAM')) {
          const pieces=['实时片段一：这段内容已经开始生成。','实时片段二：回答还在继续，尚未结束。','实时片段三：完整回答已完成。'];
          pieces.forEach((text,i)=>setTimeout(()=>{if(r.phase==='running')r.events.push(event((r.events.at(-1)?.seq||0)+1,'answer_delta',{message:1,text}));},300+i*400));
          setTimeout(()=>{if(r.phase==='running'){r.events.push(event((r.events.at(-1)?.seq||0)+1,'answer',{message:1,text:pieces.join('')}));r.phase='completed';}},1800);
        }
        return json(r);
      }
      const match=p.match(/^\/api\/agent\/runs\/([^/]+)(?:\/(approve|cancel))?$/);
      if(match) {
        const r=runs.find(r=>r.id===match[1]); if(!r) return json({code:'not_found'},404);
        if(match[2]==='cancel') {r.phase='cancelled';delete r.approval;return json({ok:true});}
        if(match[2]==='approve') {const {allowed}=req.postDataJSON();r.phase=allowed?'completed':'cancelled';delete r.approval;r.events.push(event(r.events.length+1,'answer',{text:allowed?'审批已通过；这是界面夹具，未修改任何文件。':'本次操作已拒绝。'}));}
        if(r.phase==='running' && !r.wait) {r.phase='completed';r.events.push(event(3,'hook',{stage:'PreToolUse',verdict:'allow',mode:'policy_bridge',elapsed_ms:1}),event(4,'tool_start',{id:'call_read',tool:'read_file',args:{path:'README.md'}}),event(5,'tool_end',{id:'call_read',tool:'read_file',result:'Fixture README'}),event(6,'hook',{stage:'PostToolUse',verdict:'allow',mode:'policy_bridge',elapsed_ms:1}),event(7,'answer',{text:'已读取示例项目。'}));}
        return json(r);
      }
      if(p==='/api/agent/experiences/output'){selfTestCalls++;return json({kind:'synthetic_output_self_test',scope:'project_output',model_called:false,semantic_review:false,passed:!failOutputSelfTest,safe_passed:true,blocked:true,sensitive_visible:false,tested_at:now()});}
      if(p==='/api/chat') {
        lastChat=req.postDataJSON();
        chatCalls++;const blocked=JSON.stringify(lastChat).includes('拦截夹具')||JSON.stringify(lastChat).includes('api_key=ORION_DEMO_NOT_A_REAL_CREDENTIAL');
        const complex=JSON.stringify(lastChat).includes('商品原价200元'),selected=lastChat.mode==='auto'?(complex?'standard':'small'):lastChat.mode;
        const model=selected==='standard'?'Qwen3.5-9B':selected==='small'?'Qwen3.5-4B':selected;
        const decision={reason:complex?'多步计算／约束，使用9B':lastChat.mode==='auto'?'可完整解析的单步任务':'手动指定，跳过自动决策',source:lastChat.mode==='auto'?'rule':'manual',classifier_used:false};
        const events=blocked?[{event:'decision',selected,model,decision},{event:'stage',stage:'input_blocked'},{event:'error',code:'input_blocked',error:'请求被 '+legacyGatewayName+' 输入保护拦截。',reason_code:'fixture_policy'}]:[{event:'stage',stage:'input_passed'},{event:'decision',selected,model,decision},{event:'stage',stage:'generating'},{event:'token',text:'界面回归回答'},{event:'done',selected,model,decision,actual_upstream_model:'fixture-'+selected,output_policy:'stream_no_output_review',finish_reason:truncateExperience?'length':'stop',answer:'界面回归回答',elapsed_ms:10,context_saved:!JSON.stringify(lastChat).includes('上下文失败夹具')}];
        return route.fulfill({status:200,contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
      }
      if(p==='/api/record') return json({events:[]});
      if(p==='/api/resources') {
        const sample={timestamp:now(),host:'fixture',kernel:'fixture',interval:1,cpu:0,cores:[0,0],core_ids:[0,1],frequencies:[1,1],ram_total:4*1024**3,ram_available:2*1024**3,swap_total:0,swap_free:0,disk_total:10*1024**3,disk_used:0,disk_available:10*1024**3,read_bps:0,write_bps:0,rx_bps:0,tx_bps:0,net_interfaces:[],temperatures:[],loadavg:[],uptime:1,model_processes:0,model_rss:0,model_cpu:0,models:[],docker_count:0,docker_memory:0,accelerators:{houmo:[],gpu:[],npu:[],aipu_loaded:false}};
        return json({status:'live',sample,history:[],age_seconds:0,error:'',sample_interval:1,smi_interval:2,idle_seconds:30});
      }
      return json({code:'fixture_unknown_route'},404);
    }
  };
}
