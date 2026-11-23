import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {fixtureApi} from '../tests/browser-fixture.mjs';
import {legacyGatewayName} from '../apps/console/src/lib/gateway-brand.ts';

const legacyGatewayPattern = new RegExp(legacyGatewayName, 'i');

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=path.resolve(root,process.env.ORION_BROWSER_OUTPUT||'.harness/runs/browser-regression');fs.mkdirSync(output,{recursive:true});
const live=process.argv.includes('--live');
const report={schemaVersion:1,mode:live?'device':'fixture',checks:[],runtimeErrors:[],startedAt:new Date().toISOString()};
const filter=process.env.ORION_BROWSER_FILTER?new RegExp(process.env.ORION_BROWSER_FILTER):null;
const deadline=setTimeout(()=>{fs.writeFileSync(path.join(output,'interrupted.json'),JSON.stringify(report,null,2));process.exit(2);},240000);
let server,browser,streamFixture;
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
async function check(id,fn) {
 if(filter&&!filter.test(id))return;
 const start=Date.now();try {await fn();report.checks.push({id,status:'passed',elapsedMs:Date.now()-start});}
 catch(error) {report.checks.push({id,status:'failed',error:error.message,elapsedMs:Date.now()-start});}
 console.log(report.checks.at(-1).status+' '+id);save();
}
try {
 let chat=process.env.ORION_BROWSER_CHAT_URL,dashboard=process.env.ORION_BROWSER_DASHBOARD_URL;
 if(live) {assert(chat&&dashboard,'Live mode requires explicit chat and dashboard URLs.');}
 else {
  const buildDirectory=path.join(output,'build');
  const buildEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('O6N_')));
  const build=spawnSync(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--config',path.join(root,'apps/console/vite.config.ts')],{cwd:path.join(root,'apps/console'),env:{...buildEnv,O6N_BUILD_DIR:buildDirectory,O6N_DATA_DIR:path.join(root,'examples')},encoding:'utf8'});
  assert.equal(build.status,0,build.stderr||build.stdout);
  server=createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const stream=name.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);if(stream&&streamFixture)return streamFixture.streamHTTP(req,res,stream[1]);const file=path.resolve(buildDirectory,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(buildDirectory+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");fs.createReadStream(file).pipe(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));dashboard='http://127.0.0.1:'+server.address().port+'/';chat=dashboard+'chat.html';
 }
 browser=await chromium.launch({headless:true,...(process.env.ORION_BROWSER_CHANNEL?{channel:process.env.ORION_BROWSER_CHANNEL}:{})});report.browser=browser.version();
 async function open(route,{width=1440,theme='light',fixture=!live,legacy,clipboardFixture=false}={}) {
  const context=await browser.newContext({viewport:{width,height:width===390?844:900},locale:'zh-CN',timezoneId:'Asia/Shanghai',deviceScaleFactor:1,reducedMotion:'reduce'});
  const state=fixtureApi();if(fixture)streamFixture=state;if(fixture) await context.route('**/api/**',r=>state.handle(r));
  if(legacy)await context.addInitScript(value=>{if(!localStorage.getItem('o6n-controlled-sessions-v3'))localStorage.setItem('o6n-controlled-sessions-v3',value);},JSON.stringify(legacy));
  if(clipboardFixture)await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__fixtureCopied=text;}}});});
  await context.addInitScript(()=>{window.__senderCsp=[];addEventListener('securitypolicyviolation',e=>window.__senderCsp.push(e.effectiveDirective));});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
  page.on('pageerror',e=>report.runtimeErrors.push({route,message:e.message}));
  const url=new URL(route==='agent'||route==='chat'?chat:dashboard);url.searchParams.set('theme',theme);url.hash=route==='agent'?'agent':route==='chat'?'chat':route;
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await page.getByRole('main').waitFor();
  if(route==='agent') {await page.getByLabel('输入问题',{exact:true}).waitFor();assert.equal(await page.locator('.agent-mode-label').count(),0);await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();}
  if(route==='chat') {await page.getByLabel('输入问题',{exact:true}).waitFor();await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();}
  if(route!=='chat'&&route!=='agent') await page.getByRole('heading',{name:'资源监控',exact:true,level:1}).waitFor();
  return {context,page,state};
 }
 async function audit(page) {
  await page.evaluate(axe.source);
  const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
  assert.deepEqual(violations,[],JSON.stringify(violations));
 }
 async function focused(locator) {await locator.page().waitForFunction(e=>document.activeElement===e,await locator.elementHandle());}
 async function openResourceMenu(page) {const menu=page.getByRole('menu',{name:'更多资源操作',exact:true});if(!await menu.isVisible())await page.getByRole('button',{name:'更多资源操作',exact:true}).click();await menu.waitFor();return menu;}
 async function resourceAction(page,name) {const menu=await openResourceMenu(page);await menu.getByRole('menuitem',{name,exact:true}).click();await menu.waitFor({state:'hidden'});}
 async function waitResourceIdle(page) {await page.waitForFunction(()=>{const data=document.querySelector('.resource-data');return data&&data.getAttribute('aria-busy')!=='true';});}

 if(!live)for(const width of [1440,390])await check(`strict-csp-modal-sheet-scroll-and-focus-${width}`,async()=>{
  const {context,page,state}=await open('chat',{width});try{
   const before=await page.evaluate(()=>({overflow:document.body.style.overflow,padding:document.body.style.paddingRight}));
   const privacy=page.getByRole('button',{name:'隐私与安全',exact:true});await privacy.click();
   const dialog=page.getByRole('dialog',{name:'隐私与安全',exact:true});await dialog.waitFor();
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
   for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(element=>element.contains(document.activeElement)));}
   await audit(page);assert.deepEqual(await page.evaluate(()=>window.__senderCsp),[]);
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await focused(privacy);
   await page.waitForFunction(expected=>document.body.style.overflow===expected.overflow&&document.body.style.paddingRight===expected.padding,before);
   if(width===390){
    const trigger=page.getByRole('button',{name:'打开导航',exact:true});await trigger.click();const sheet=page.getByRole('dialog',{name:'工作台导航',exact:true});await sheet.waitFor();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
    for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert(await sheet.evaluate(element=>element.contains(document.activeElement)));}
    await audit(page);assert.deepEqual(await page.evaluate(()=>window.__senderCsp),[]);
    await page.mouse.click(width-4,200);await sheet.waitFor({state:'hidden'});await focused(trigger);
    await page.waitForFunction(expected=>document.body.style.overflow===expected.overflow&&document.body.style.paddingRight===expected.padding,before);
   }
   await page.getByRole('button',{name:/^选择回答模型，当前 /}).click();await page.getByRole('radio',{name:/^仅本地/}).check();await page.keyboard.press('Escape');
   assert.deepEqual(await page.evaluate(()=>window.__senderCsp),[]);assert.equal(state.chatCalls,0);
  }finally{await context.close();}
 });

 if(!live)await check('quick-experience-length-limit-is-visible-and-retry-clears-failure',async()=>{
  const {context,page,state}=await open('chat');try{
   state.truncateExperience=true;await page.getByRole('button',{name:'体验自动选模',exact:true}).click();const dialog=page.getByRole('dialog',{name:'快速体验',exact:true});await dialog.getByRole('button',{name:'运行简单任务',exact:true}).click();await dialog.getByText('回答达到输出长度上限，以下为实际片段，可重试体验。',{exact:true}).waitFor();assert.match(await dialog.getByRole('group',{name:'简单任务体验结果',exact:true}).innerText(),/Qwen3.5-4B/);
   state.truncateExperience=false;await dialog.getByRole('button',{name:'运行简单任务',exact:true}).click();await dialog.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(await dialog.getByText('回答达到输出长度上限，以下为实际片段，可重试体验。',{exact:true}).count(),0);assert.equal(state.chatCalls,2);await audit(page);
  }finally{await context.close();}
 });
 if(!live)await check('quick-experience-stop-retains-draft-and-blocks-main-send',async()=>{
  const {context,page,state}=await open('chat');try{
   await context.route('**/api/chat',async route=>{await new Promise(resolve=>setTimeout(resolve,600));try{await state.handle(route);}catch{}});
   const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('停止后保留此草稿');await page.getByRole('button',{name:'体验自动选模',exact:true}).click();const dialog=page.getByRole('dialog',{name:'快速体验',exact:true});await dialog.getByRole('button',{name:'运行简单任务',exact:true}).dblclick();
   await dialog.getByRole('button',{name:'停止体验',exact:true}).waitFor();assert(await page.getByRole('button',{name:'发送消息',exact:true,includeHidden:true}).isDisabled());await dialog.getByRole('button',{name:'停止体验',exact:true}).click();await dialog.getByText('已停止体验。设备可能仍在结束本次请求。',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await prompt.inputValue(),'停止后保留此草稿');assert(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled());assert(state.chatCalls<=1);await audit(page);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390,320])for(const theme of ['light','dark'])await check(`quick-experience-real-receipts-and-isolation-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('chat',{width,theme});try{
   const prompt=page.getByLabel('输入问题',{exact:true}),picker=page.getByRole('button',{name:/^选择回答模型，当前 /});
   await picker.click();await page.getByRole('option',{name:/^Qwen3.5-2B/}).click();await prompt.fill('需要保留的当前会话草稿');const currentUrl=page.url();
   await page.getByRole('button',{name:'体验自动选模',exact:true}).click();const dialog=page.getByRole('dialog',{name:'快速体验',exact:true});await dialog.waitFor();await audit(page);
   await dialog.getByRole('button',{name:'运行简单任务',exact:true}).click();const simple=dialog.getByRole('group',{name:'简单任务体验结果',exact:true});await simple.getByText('Qwen3.5-4B',{exact:true}).waitFor();assert.match(await simple.innerText(),/规则识别/);assert.match(await simple.innerText(),/输入：检查通过/);
   await dialog.getByRole('button',{name:'运行复杂任务',exact:true}).click();const complex=dialog.getByRole('group',{name:'复杂任务体验结果',exact:true});await complex.getByText('Qwen3.5-9B',{exact:true}).waitFor();assert.equal(state.lastChat.scope,'local');assert.equal(state.lastChat.mode,'auto');assert.equal(state.lastChat.messages.length,1);assert.equal(state.lastChat.conversation_id,undefined);assert.equal(state.lastChat.project,undefined);
   await audit(page);await page.screenshot({path:path.join(output,`experience-routing-${width}-${theme}.png`),fullPage:true});
   await dialog.getByRole('button',{name:'输入拦截',exact:true}).click();await dialog.getByRole('button',{name:'运行输入拦截体验',exact:true}).click();await dialog.getByText('已拦截虚构凭据，未调用回答模型。',{exact:true}).waitFor();assert.equal(state.lastChat.mode,'small');await dialog.getByText('未调用回答模型',{exact:true}).waitFor();
   await dialog.getByRole('button',{name:'输出保护自检',exact:true}).click();await dialog.getByRole('button',{name:'运行输出保护自检',exact:true}).click();await dialog.getByText('项目敏感输出已拦截',{exact:true}).waitFor();assert.equal(state.chatCalls,3);assert.equal(state.selfTestCalls,1);assert.match(await dialog.innerText(),/未调用回答模型/);assert.match(await dialog.innerText(),/普通聊天未启用输出审核/);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await page.screenshot({path:path.join(output,`experience-output-${width}-${theme}.png`),fullPage:true});
   await page.keyboard.press('Escape');await focused(page.getByRole('button',{name:'体验自动选模',exact:true}));assert.equal(await prompt.inputValue(),'需要保留的当前会话草稿');assert.match(await picker.innerText(),/Qwen3.5-2B/);assert.equal(page.url(),currentUrl);assert.equal(state.runs.length,40);assert(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('ORION_DEMO_NOT_A_REAL_CREDENTIAL'));
   await prompt.fill('普通提问');await prompt.press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();const facts=page.getByRole('group',{name:'本轮模型与保护结果',exact:true});assert.match(await facts.innerText(),/输入：检查通过/);assert.match(await facts.innerText(),/普通聊天未启用输出审核/);await audit(page);
  }finally{await context.close();}
 });
 if(!live)await check('quick-experience-does-not-present-failed-output-selftest-as-protection-success',async()=>{
  const {context,page,state}=await open('chat');try{
   state.failOutputSelfTest=true;await page.getByRole('button',{name:'体验安全保护',exact:true}).click();const dialog=page.getByRole('dialog',{name:'快速体验',exact:true});await dialog.getByRole('button',{name:'输出保护自检',exact:true}).click();await dialog.getByRole('button',{name:'运行输出保护自检',exact:true}).click();await dialog.getByText('输出保护自检未通过或回执不完整，未将本次结果标为成功。',{exact:true}).waitFor();assert.equal(await dialog.getByText('项目敏感输出已拦截',{exact:true}).count(),0);assert.equal(state.chatCalls,0);await audit(page);
  }finally{await context.close();}
 });
 for(const width of [1440,390,320])for(const theme of ['light','dark'])await check(`privacy-rules-and-scope-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('chat',{width,theme});try{
   const prompt=page.getByLabel('输入问题',{exact:true}),privacy=page.getByRole('button',{name:'隐私与安全',exact:true});
   const sends=[];page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(?:chat|route|agent\/runs)$/.test(new URL(r.url()).pathname))sends.push(r.url());});
   await prompt.fill('保留这份尚未发送的草稿');
   const pb=await privacy.boundingBox(),mb=await page.getByRole('button',{name:/^选择回答模型，当前 /}).boundingBox();assert(pb.x>=mb.x+mb.width-1&&pb.x+pb.width<=width,'Privacy entry should stay beside the model scope');
   await privacy.click();const dialog=page.getByRole('dialog',{name:'隐私与安全',exact:true});await dialog.waitFor();
   await dialog.getByRole('heading',{name:'内容会经过哪里',exact:true}).waitFor();
   const current=dialog.getByRole('region',{name:'当前调用设置',exact:true});assert.match(await current.innerText(),/允许云端/);assert.match(await current.innerText(),/可能发往 DeepSeek/);
   assert.match(await dialog.innerText(),/未启用完整的语义输出审核/);assert.match(await dialog.innerText(),/浏览器存储/);assert.match(await dialog.innerText(),/逐项确认/);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Privacy dialog overflow');await audit(page);await page.screenshot({path:path.join(output,`privacy-${width}-${theme}-hybrid.png`),fullPage:true});
   await page.keyboard.press('Escape');await focused(privacy);assert.equal(await prompt.inputValue(),'保留这份尚未发送的草稿');
   await page.getByRole('button',{name:/^选择回答模型，当前 /}).click();await page.getByRole('radio',{name:/^仅本地/}).check();await page.keyboard.press('Escape');
   await privacy.click();await dialog.waitFor();assert.match(await current.innerText(),/仅本地/);assert.match(await current.innerText(),/服务端禁止调用云端回答模型/);assert.equal(await dialog.getByText('本地回答模型 / 获准使用的 DeepSeek → 浏览器',{exact:true}).count(),0);
   await audit(page);await page.screenshot({path:path.join(output,`privacy-${width}-${theme}-local.png`),fullPage:true});
   await dialog.getByRole('button',{name:'知道了',exact:true}).click();await focused(privacy);assert.equal(await prompt.inputValue(),'保留这份尚未发送的草稿');assert.deepEqual(sends,[]);if(!live)assert.equal(state.chatCalls,0);
  }finally{await context.close();}
 });
 if(!live)await check('privacy-distinguishes-manual-local-cloud-and-incompatible-scope',async()=>{
  const {context,page,state}=await open('chat');try{
   const picker=page.getByRole('button',{name:/^选择回答模型，当前 /}),privacy=page.getByRole('button',{name:'隐私与安全',exact:true}),dialog=page.getByRole('dialog',{name:'隐私与安全',exact:true});
   await picker.click();await page.getByRole('option',{name:/^Qwen3.5-4B/}).click();await privacy.click();await dialog.waitFor();assert.match(await dialog.getByRole('region',{name:'当前调用设置',exact:true}).innerText(),/指定的本地模型使用本地回答/);await dialog.getByText('本地回答模型 → 浏览器',{exact:true}).waitFor();await page.keyboard.press('Escape');
   await picker.click();await page.getByRole('option',{name:/^DeepSeek/}).click();await privacy.click();await dialog.waitFor();assert.match(await dialog.getByRole('region',{name:'当前调用设置',exact:true}).innerText(),/当前指定 DeepSeek 云端回答/);await dialog.getByText('DeepSeek → 浏览器',{exact:true}).waitFor();await page.keyboard.press('Escape');
   await picker.click();await page.getByRole('radio',{name:/^仅本地/}).check();await page.keyboard.press('Escape');await privacy.click();await dialog.waitFor();assert.match(await dialog.getByRole('region',{name:'当前调用设置',exact:true}).innerText(),/发送已暂停/);await dialog.getByText('调整调用设置后再发送',{exact:true}).waitFor();assert.equal(state.chatCalls,0);await audit(page);
  }finally{await context.close();}
 });
 if(!live)await check('real-task-starters-preserve-drafts-and-stay-in-chat',async()=>{
  const {context,page,state}=await open('chat');try{
   const prompt=page.getByLabel('输入问题',{exact:true});
   assert.equal(await page.locator('.chat-starters>button').count(),2);assert.equal(await page.locator('.chat-starters').getByText('隐私与安全',{exact:true}).count(),0);
   await page.getByRole('button',{name:/^整理信息/}).click();await focused(prompt);assert.match(await prompt.inputValue(),/待办事项表（事项、负责人、截止时间）/);assert.match(await prompt.inputValue(),/虚构示例/);assert(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled());
   const draft=await prompt.inputValue();await page.getByRole('button',{name:/^分析代码/}).click();assert.equal(await prompt.inputValue(),draft);await page.getByText('请先发送或清空当前草稿，再使用任务示例。',{exact:true}).waitFor();
   await prompt.fill('');await page.getByRole('button',{name:/^分析代码/}).click();await focused(prompt);assert.match(await prompt.inputValue(),/average_paid_amount/);assert.match(await prompt.inputValue(),/空列表、没有已支付订单/);assert(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled());assert.equal(state.chatCalls,0);assert.equal(state.runs.length,40);await audit(page);
  }finally{await context.close();}
 });
 for(const route of ['resources','chat','agent']) for(const width of [1440,390]) for(const theme of ['light','dark']) {
  await check(`matrix-${route}-${width}-${theme}`,async()=>{
   const {context,page}=await open(route,{width,theme});try {
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),theme);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow');
    if(route==='resources') {await page.getByText('CPU · 整机占用',{exact:true}).waitFor();await resourceAction(page,'暂停刷新');await page.getByText('已暂停页面刷新，当前数值为保留快照。',{exact:true}).waitFor();}
    if(route==='agent') {assert.equal(await page.locator('textarea:visible').count(),1);assert.equal(await page.getByRole('link',{name:'Pi Agent',exact:true}).count(),0);if(width===390){await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('dialog',{name:'工作台导航'}).waitFor();await audit(page);await page.keyboard.press('Escape');await focused(page.getByRole('button',{name:'打开导航',exact:true}));}else{const nav=await page.getByRole('navigation',{name:'最近对话',exact:true}).boundingBox();const tools=await page.getByRole('navigation',{name:'工作台工具',exact:true}).boundingBox();assert(nav.y+nav.height<=tools.y+1,'History overlaps navigation');}}

    await audit(page);
    await page.screenshot({path:path.join(output,`${route}-${width}-${theme}.png`),fullPage:true});
   } finally {await context.close();}
  });
 }
 await check('keyboard-theme-navigation',async()=>{
  const {context,page}=await open('agent');try {
   const prompt=page.getByLabel('输入问题',{exact:true});await prompt.focus();await page.keyboard.press('Control+k');
   await focused(page.getByLabel('搜索对话',{exact:true}));
   await page.keyboard.press('Escape');await prompt.focus();
   await page.getByRole('button',{name:/外观与(?:使用说明|偏好)$/}).last().click();
   const dialog=page.getByRole('dialog',{name:'外观与使用说明'});await dialog.waitFor();await dialog.getByLabel('暗色',{exact:true}).check();
   await page.keyboard.press('Escape');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   const url=new URL(page.url());url.searchParams.delete('theme');await page.goto(url.href);await page.getByLabel('输入问题',{exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   await page.getByLabel('输入问题',{exact:true}).waitFor();
   await page.keyboard.press('Control+k');await focused(page.getByLabel('搜索对话',{exact:true}));await page.keyboard.press('Escape');
  } finally {await context.close();}
 });
 for(const width of [1440,1366,390])for(const theme of ['light','dark'])await check(`model-overlay-bounds-${width}-${theme}`,async()=>{
  const {context,page}=await open('chat',{width,theme});try{
   const height=width===1366?768:width===390?844:900;await page.setViewportSize({width,height});
   const trigger=page.getByRole('button',{name:/^选择回答模型，当前 Auto/});await trigger.click();
   const overlay=width===390?page.getByRole('dialog',{name:'回答模型',exact:true}):page.locator('.model-picker-popover');
   const box=await overlay.boundingBox(),search=page.getByRole('searchbox',{name:'搜索回答模型',exact:true}),sb=await search.boundingBox();
   assert(box.y>=0&&box.x>=0&&box.y+box.height<=height+1&&box.x+box.width<=width+1,JSON.stringify(box));assert(sb.y>=0&&sb.y+sb.height<=height,'Model search is offscreen');
   if(width===1440){const area=await page.locator('.model-picker-scroll').boundingBox(),last=await page.getByRole('option',{name:/^DeepSeek/}).boundingBox();assert.equal(await page.getByRole('listbox',{name:'回答模型',exact:true}).getByRole('option').count(),8);assert(last.y+last.height<=area.y+area.height+1,'All eight answer options should fit on a desktop');}
   await search.focus();await search.press('ArrowDown');await page.keyboard.press('End');const cloud=page.getByRole('option',{name:/^DeepSeek/});await focused(cloud);const cb=await cloud.boundingBox();assert(cb.y>=box.y&&cb.y+cb.height<=box.y+box.height,'Keyboard selection did not scroll into view');
   await audit(page);await page.screenshot({path:path.join(output,`models-${width}-${theme}.png`),fullPage:true});await page.keyboard.press('Escape');await focused(trigger);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])for(const theme of ['light','dark'])await check(`unified-agent-no-project-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('agent',{width,theme});try{
   const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('不绑定项目也能聊天');
   assert.equal(await page.getByRole('button',{name:/工作模式/}).count(),0);assert.equal(await page.getByRole('listbox',{name:'选择工作模式'}).count(),0);
   assert.equal(await page.locator('.agent-mode-label').count(),0);
   assert(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled());await audit(page);await page.screenshot({path:path.join(output,`unified-agent-${width}-${theme}.png`),fullPage:true});
   await prompt.press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.chatCalls,1);assert.equal(state.runs.length,40);
   const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('orion-workspace-sessions-v1')));assert(stored.some(c=>c.messages.some(m=>m.snapshot?.mode==='agent'&&m.snapshot?.execution==='answer')));
  }finally{await context.close();}
 });
 async function preparePi(page) {
  await page.getByRole('button',{name:'添加上下文',exact:true}).click();
  await page.locator('.context-popover').getByRole('button',{name:'沙盒项目',exact:false}).click();
  await page.getByLabel('README.md',{exact:true}).waitFor();await page.keyboard.press('Escape');
  
 }
 if(!live) {
  for(const width of [1440,390])for(const theme of ['light','dark'])await check(`answer-pool-and-images-${width}-${theme}`,async()=>{
   const {context,page,state}=await open('chat',{width,theme});try{
    const prompt=page.getByRole('textbox',{name:'输入问题',exact:true});await prompt.fill('请描述图片中的颜色');
    await page.getByRole('button',{name:/^选择回答模型，当前 /}).click();
    for(const name of ['Qwen3.5-4B','Qwen3.5-2B','MiniCPM-V 4.7 1B'])assert.equal(await page.getByRole('option',{name:new RegExp('^'+name.replaceAll('.','\\.'))}).count(),1);
    await page.getByRole('option',{name:/^MiniCPM-V/}).click();assert.equal(await prompt.inputValue(),'请描述图片中的颜色');
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=60;const d=c.getContext('2d');d.fillStyle='red';d.fillRect(0,0,80,60);return c.toDataURL('image/png').split(',')[1];});
    await page.getByLabel('选择图片文件',{exact:true}).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.getByAltText('待发送图片 1',{exact:true}).waitFor();await audit(page);
    await page.getByRole('button',{name:/^选择回答模型，当前 /}).click();assert(await page.getByRole('option',{name:/^Qwen3.5-2B/}).isDisabled());assert(await page.getByRole('option',{name:/^DeepSeek/}).isDisabled());await page.keyboard.press('Escape');
    await page.screenshot({path:path.join(output,`vision-composer-${width}-${theme}.png`),fullPage:true});
    await page.getByRole('button',{name:'移除图片 1',exact:true}).click();assert.equal(await page.getByAltText('待发送图片 1',{exact:true}).count(),0);
    await prompt.evaluate((e,base64)=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'paste.png',{type:'image/png'}));e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));},png);
    await page.getByAltText('待发送图片 1',{exact:true}).waitFor();await prompt.press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.lastChat.mode,'vision');assert(state.lastChat.messages.at(-1).content.some(p=>p.type==='image_url'));assert(await page.getByRole('button',{name:'添加图片',exact:true}).isEnabled());
   }finally{await context.close();}
  });
  await check('unified-agent-project-model-admission-and-direct-answer',async()=>{
   const {context,page,state}=await open('chat');try{
    await preparePi(page);const prompt=page.getByLabel('输入问题',{exact:true});
    await page.getByRole('button',{name:/^选择回答模型，当前 /}).click();await page.getByRole('option',{name:/^Qwen3.5-4B/}).click();
    await prompt.fill('你好');await prompt.press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.lastChat.mode,'small');assert.equal(state.lastChat.project,'demo');assert.equal(state.runs.length,40);
    await prompt.fill('读取 README.md');await page.getByText('当前模型仅支持对话；项目操作请切换 Auto 或 9B。',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled());
    await page.getByRole('button',{name:'切换 9B 并保留草稿',exact:true}).click();assert.equal(await prompt.inputValue(),'读取 README.md');assert.equal(state.runs.length,40);
    await prompt.press('Enter');await page.getByText('已读取示例项目。',{exact:true}).waitFor();assert.equal(state.lastAgent.model,'standard');assert.equal(state.lastAgent.access,'read');assert.equal(state.lastAgent.scope,'local');
    await prompt.fill('修改 demo.py APPROVAL，内容如下：```python\nprint(2)\n```');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('region',{name:'待审批操作'}).waitFor();assert.equal(state.lastAgent.access,'edit');await page.getByRole('button',{name:'拒绝',exact:true}).click();await page.getByText('本次操作已拒绝。',{exact:true}).waitFor();await audit(page);
   }finally{await context.close();}
  });
  await check('unified-agent-needs-project-and-legacy-ask-draft',async()=>{
   const legacy=[{id:'a'.repeat(32),title:'旧 Ask 草稿恢复',messages:[{id:'old-user',role:'user',content:'之前的正常提问',snapshot:{mode:'ask',model:'small',scope:'local',project:null,files:[]}},{id:'old-reply',role:'assistant',content:'',meta:{error:{code:'connection_error',error:'旧轮次未完成'}}}]}];
   const {context,page,state}=await open('chat',{legacy});try{
    const prompt=page.getByLabel('输入问题',{exact:true});await page.getByRole('button',{name:'编辑后重发',exact:true}).click();assert.equal(await prompt.inputValue(),'之前的正常提问');assert.equal(await page.locator('.agent-mode-label').count(),0);
    await prompt.fill('读取 README.md');await page.getByText('访问项目文件前，请先选择项目。',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled());assert.equal(state.chatCalls,0);assert.equal(state.runs.length,40);
    await page.getByRole('button',{name:'选择项目',exact:true}).click();await page.locator('.context-popover').getByRole('button',{name:/沙盒项目/}).click();await page.keyboard.press('Escape');assert.equal(await prompt.inputValue(),'读取 README.md');await page.getByRole('button',{name:'切换 9B 并保留草稿',exact:true}).click();await prompt.press('Enter');await page.getByText('已读取示例项目。',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('o6n-controlled-sessions-v3'))),legacy);await audit(page);
   }finally{await context.close();}
  });
  await check('chat-model-picker-keyboard',async()=>{
   const {context,page,state}=await open('chat',{width:390});try {
    await page.getByRole('button',{name:'选择回答模型，当前 Auto'}).click();await page.getByRole('radio',{name:/允许云端/}).waitFor();await audit(page);await page.keyboard.press('Escape');await focused(page.getByRole('button',{name:'选择回答模型，当前 Auto'}));
    await page.getByRole('button',{name:'对话操作',exact:true}).click();await audit(page);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'选择回答模型，当前 Auto'}).click();await page.getByLabel('搜索回答模型',{exact:true}).fill('MiniCPM5');await audit(page);
    await page.getByLabel('搜索回答模型',{exact:true}).press('ArrowDown');await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'选择回答模型，当前 MiniCPM5-2B'}).waitFor();assert.equal(await page.getByRole('listbox',{name:'回答模型'}).count(),0);
    await page.getByRole('button',{name:'选择回答模型，当前 MiniCPM5-2B'}).click();await page.getByRole('option',{name:/Auto/}).click();await page.getByLabel('输入问题',{exact:true}).fill('立即发送');await page.getByLabel('输入问题',{exact:true}).press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.lastChat.mode,'auto');
   } finally {await context.close();}
  });
  await check('agent-approval-focus-and-denial',async()=>{
   const {context,page,state}=await open('agent',{width:390});try {
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('修改 demo.py APPROVAL');await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const region=page.getByRole('region',{name:'待审批操作'});await region.waitFor();assert(await region.evaluate(e=>document.activeElement===e),'Approval focus');
    await region.getByRole('button',{name:'拒绝',exact:true}).click();await page.getByText('本次操作已拒绝。',{exact:true}).waitFor();assert.equal(state.runs[0].phase,'cancelled');
    await audit(page);await page.screenshot({path:path.join(output,'approval-denied.png'),fullPage:true});
   } finally {await context.close();}
  });
  await check('agent-approval-allow-and-tool-details',async()=>{
   const {context,page}=await open('agent');try {
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('修改 demo.py APPROVAL');await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const region=page.getByRole('region',{name:'待审批操作'});await region.waitFor();await audit(page);await page.screenshot({path:path.join(output,'approval-pending.png'),fullPage:true});
    await region.getByRole('button',{name:'允许本次',exact:true}).click();await page.getByText('审批已通过；这是界面夹具，未修改任何文件。',{exact:true}).waitFor();
   } finally {await context.close();}
  });
  await check('agent-cancel-block-retry',async()=>{
   const {context,page,state}=await open('agent');try {
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:'停止回答',exact:true}).click();await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();assert.equal(state.runs[0].phase,'cancelled');
    await page.getByLabel('输入问题',{exact:true}).fill('BLOCK');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('安全审核拒绝了本次内容。',{exact:true}).waitFor();await page.getByText('未调用模型',{exact:true}).waitFor();assert.equal(state.runs[0].events.filter(e=>e.type==='tool_end').length,0);
    state.failHealth=true;await page.reload();await page.getByText('Pi 连接暂不可用；普通问答仍可使用。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled(),true);state.failHealth=false;await page.reload();await page.getByRole('button',{name:'添加上下文',exact:true}).waitFor();
   } finally {await context.close();}
  });
  await check('chat-ime-newline-stream-block-history',async()=>{
   const {context,page,state}=await open('chat');try {
    const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('回归');await prompt.press('Shift+Enter');assert.equal(state.chatCalls,0);
    await prompt.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true})));assert.equal(state.chatCalls,0);
    await prompt.press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.chatCalls,1);
    await prompt.fill('拦截夹具');await prompt.press('Enter');await page.getByText('AI Gateway 已拦截本次输入',{exact:true}).waitFor();assert.equal(state.chatCalls,2);
     await page.getByText('请求被 AI Gateway 输入保护拦截。',{exact:true}).waitFor();assert(!legacyGatewayPattern.test(await page.locator('body').innerText()),'Legacy gateway diagnostic exposed');
    const stored=await page.evaluate(()=>localStorage.getItem('orion-workspace-sessions-v1'));assert(!stored.includes('拦截夹具'),'Rejected content persisted');await audit(page);
     await page.reload();await page.getByText('请求被 AI Gateway 输入保护拦截。',{exact:true}).waitFor();await page.getByRole('button',{name:'展开执行详情',exact:true}).last().click();await page.locator('details.execution-advanced > summary').click();await page.getByText('查看结果类型',{exact:true}).click();assert(!legacyGatewayPattern.test(await page.locator('body').innerText()),'Legacy history or error details exposed');
    await prompt.fill('上下文失败夹具');await prompt.press('Enter');await page.getByText('回答已完成，但服务端未保存本轮上下文；后续项目任务可能无法接续，请补充必要背景。',{exact:true}).waitFor();
   } finally {await context.close();}
  });
  await check('agent-ime-and-single-submit',async()=>{
   const {context,page,state}=await open('agent');try {
    await preparePi(page);const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('读取示例');await prompt.press('Shift+Enter');assert.equal(state.runs.length,40);
    await prompt.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));assert.equal(state.runs.length,40);
    await prompt.press('Enter');await page.getByText('已读取示例项目。',{exact:true}).waitFor();assert.equal(state.runs.length,41);
    await page.getByRole('button',{name:'展开执行详情',exact:true}).click();await page.locator('details.execution-advanced > summary').click();await page.locator('details.hook-summary > summary').click();assert.equal(await page.locator('.agent-hook').count(),3);assert.equal(await page.locator('details.agent-tool').count(),1);await page.locator('details.agent-tool summary').click();await page.getByText('Fixture README',{exact:true}).waitFor();
    await audit(page);
   } finally {await context.close();}
  });
  await check('legacy-migration-does-not-overwrite-original-key',async()=>{
   const legacy=[{id:'a'.repeat(32),title:'迁移前的对话',messages:[{id:'old-user',role:'user',content:'迁移前内容'},{id:'old-reply',role:'assistant',content:'迁移前回答'}]}];
   const {context,page}=await open('chat',{legacy});try{
    await page.getByText('迁移前回答',{exact:true}).waitFor();await page.getByLabel('输入问题',{exact:true}).fill('继续');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('界面回归回答',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('o6n-controlled-sessions-v3'))),legacy);
    await page.reload();await page.getByText('迁移前回答',{exact:true}).waitFor();assert.equal(await page.getByText('界面回归回答',{exact:true}).count(),1);
   }finally{await context.close();}
  });
  await check('one-conversation-cross-engine-and-compatible-models',async()=>{
   const {context,page,state}=await open('chat');try{
    const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('记住测试代号');await prompt.press('Enter');await page.getByText('界面回归回答',{exact:true}).waitFor();const cid=state.lastChat.conversation_id;
    await preparePi(page);
    await page.getByRole('button',{name:'选择回答模型，当前 Auto'}).click();assert(await page.getByRole('option',{name:/MiniCPM5-2B/}).isEnabled());assert(await page.getByRole('option',{name:/Qwen3.8-27B/}).isEnabled());await page.keyboard.press('Escape');
    await prompt.fill('根据之前的测试代号读取项目');await prompt.press('Enter');await page.getByText('已读取示例项目。',{exact:true}).waitFor();assert.equal(state.runs[0].conversationId,cid);assert.equal(state.runs[0].access,'read');
    await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();await page.getByRole('button',{name:'添加上下文',exact:true}).click();await page.getByRole('button',{name:'移除项目上下文',exact:true}).click();await prompt.fill('总结刚才的任务');await prompt.press('Enter');
    await page.waitForFunction(()=>[...document.querySelectorAll('.markdown')].filter(e=>e.textContent==='界面回归回答').length===2);assert.equal(state.lastChat.conversation_id,cid);assert(JSON.stringify(state.lastChat.messages).includes('已读取示例项目。'));assert.equal(await page.locator('main').count(),1);assert.equal(await page.locator('textarea:visible').count(),1);
   }finally{await context.close();}
  });
  await check('pending-approval-refresh-and-history-browsing',async()=>{
   const {context,page,state}=await open('agent',{width:390});try{
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('修改 demo.py APPROVAL WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('region',{name:'待审批操作'}).waitFor();const id=state.runs[0].id;
    await page.reload();await page.getByRole('region',{name:'待审批操作'}).waitFor();assert.equal(state.runs[0].id,id);await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'新建对话',exact:true}).click();await page.getByText('另一会话正在执行，结束后可发送新消息。',{exact:true}).waitFor();await page.getByRole('button',{name:'返回执行中的会话',exact:true}).click();
    const approval=page.getByRole('region',{name:'待审批操作'});await approval.waitFor();await audit(page);await page.screenshot({path:path.join(output,'approval-mobile-restored.png'),fullPage:true});await approval.getByRole('button',{name:'拒绝',exact:true}).click();await page.getByText('本次操作已拒绝。',{exact:true}).waitFor();
   }finally{await context.close();}
  });
  for(const width of [1440,390])for(const theme of ['light','dark'])await check(`readable-long-message-${width}-${theme}`,async()=>{
   const markdown=['### 一次完整的分析','中文长段落，保持清晰的阅读节奏。'.repeat(12),'```python\ndef demo():\n    return "'+'long-token-'.repeat(40)+'"\n```','| 模型 | 说明 |\n| --- | --- |\n| 本地 | '+'长内容'.repeat(50)+' |','- 支持逐步分析\n- 保留已完成的上下文'].join('\n\n');
   const legacy=[{id:'d'.repeat(32),title:'这是一条用于验证标题截断与正文阅读的很长会话名称'.repeat(5),messages:[{id:'long-user',role:'user',content:'请分析下面的结果，并给出表格和代码。'},{id:'long-reply',role:'assistant',content:markdown,meta:{request_id:'fixture-long-request',selected:'standard',model:'Qwen3.5-9B',mode:'standard',elapsed_ms:1234,stages:[{stage:'completed'}]}}]}];
   const {context,page}=await open('chat',{width,theme,legacy,clipboardFixture:true});try{
    const code=page.getByRole('button',{name:'复制代码',exact:true});await code.scrollIntoViewIfNeeded();await code.click();await page.getByRole('button',{name:'已复制',exact:true}).waitFor();assert((await page.evaluate(()=>window.__fixtureCopied)).includes('def demo'));assert(await page.getByRole('region',{name:'回答中的表格，可横向滚动'}).count());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.getByRole('button',{name:'展开执行详情',exact:true}).click();if(width===390)await page.getByRole('dialog',{name:'本轮执行',exact:true}).waitFor();else await page.getByRole('complementary',{name:'本轮执行详情'}).waitFor();await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByText('通过输入框的上下文选择项目与文件。',{exact:true}).waitFor();await audit(page);await page.screenshot({path:path.join(output,`reading-inspector-${width}-${theme}.png`),fullPage:true});if(width===390)await page.keyboard.press('Escape');else await page.getByRole('button',{name:'关闭执行详情',exact:true}).first().click();await audit(page);await page.screenshot({path:path.join(output,`long-message-${width}-${theme}.png`),fullPage:true});
   }finally{await context.close();}
  });
  await check('composer-context-and-short-viewport',async()=>{
   const {context,page}=await open('agent',{width:390});try{
    await page.getByRole('button',{name:'添加上下文',exact:true}).click();await page.locator('.context-popover').getByRole('button',{name:'沙盒项目',exact:false}).click();await page.getByLabel('README.md',{exact:true}).check();await page.keyboard.press('Escape');
    const chips=await page.locator('.composer-context-row').boundingBox(),text=await page.getByLabel('输入问题',{exact:true}).boundingBox();assert(chips.y+chips.height<=text.y+1,'Context must precede the text input');
    await page.setViewportSize({width:390,height:600});await page.getByRole('button',{name:'选择回答模型，当前 Auto'}).click();await page.getByRole('radio',{name:/允许云端/}).click();await page.getByRole('option',{name:/^DeepSeek/}).click();await page.getByLabel('输入问题',{exact:true}).fill('多行草稿\n'.repeat(20));const send=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();assert(send.y+send.height<=600,'Send is hidden on short viewport');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await page.screenshot({path:path.join(output,'context-short-mobile.png'),fullPage:true});
   }finally{await context.close();}
  });
  await check('sidebar-search-status-and-clear',async()=>{
   const {context,page}=await open('chat');try{
    const search=page.getByLabel('搜索对话',{exact:true});await search.fill('不存在的标题');await page.getByText('没有匹配的对话',{exact:true}).waitFor();await page.getByRole('button',{name:'清除搜索',exact:true}).click();await page.locator('.session-meta').filter({hasText:'Agent · 已完成'}).first().waitFor();assert.equal(await search.inputValue(),'');await audit(page);
   }finally{await context.close();}
  });
  await check('fresh-deep-link-restores-chat-and-complete-tool-history',async()=>{
   const {context,page,state}=await open('chat');try{
    const cid='e'.repeat(32),id='11111111-1111-4111-8111-111111111111',created=new Date().toISOString(),snapshot={mode:'ask',model:'auto',project:'demo',files:[]};
    state.runs.unshift({id,conversationId:cid,turnId:'f'.repeat(32),project:'demo',model:'auto',access:'read',selected:'standard',phase:'completed',created,events:[{seq:1,type:'prompt',at:created,data:{text:'读取历史项目'}},{seq:2,type:'tool_start',at:created,data:{id:'history-read',tool:'read_file',args:{path:'README.md'}}},{seq:3,type:'tool_end',at:created,data:{id:'history-read',tool:'read_file',result:'Fixture historical README'}},{seq:4,type:'answer',at:created,data:{text:'历史项目回答'}}]});
    state.conversations.set(cid,{id:cid,project:'demo',created,runIds:[id],turns:[{id:'g'.repeat(32),prompt:'历史普通问答',answer:'历史普通回答',created,snapshot:{...snapshot,project:null}},{id:'f'.repeat(32),runId:id,prompt:'读取历史项目',answer:'历史项目回答',created,snapshot}],context:[]});
    const url=new URL(page.url());url.searchParams.set('conversation',cid);await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.getByText('历史普通回答',{exact:true}).waitFor();await page.getByText('历史项目回答',{exact:true}).waitFor();await page.getByRole('button',{name:'展开执行详情',exact:true}).click();await page.locator('details.agent-tool summary').click();await page.getByText('Fixture historical README',{exact:true}).waitFor();await page.reload();await page.getByText('历史项目回答',{exact:true}).waitFor();assert.equal(await page.getByText('历史普通回答',{exact:true}).count(),1);await audit(page);
   }finally{await context.close();}
  });
 }
 if(!live) {
  await check('harness-autosize-limit-and-responsive',async()=>{
   for(const width of [1440,390])for(const theme of ['light','dark']) {
    const {context,page}=await open('chat',{width,theme});try {
     const prompt=page.getByRole('textbox',{name:'输入问题',exact:true});
     assert.equal(await page.locator('.harness-composer > [data-slot="input-group"]').count(),1);
     assert.equal(await page.locator('[id="prompt"]').count(),1);
     assert.deepEqual(await page.evaluate(()=>window.__senderCsp),[],'Harness PromptInput must work under production CSP without violations');
     assert.equal(await prompt.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px','The InputGroup must own the only input border');
     const actionBox=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();assert(actionBox.width<=48&&actionBox.height<=48,'Legacy sizing must not override the library icon button');
     const initial=(await prompt.boundingBox()).height;
     await prompt.fill('组件库自动增高测试\n'.repeat(16));
     await page.waitForFunction(()=>{const e=document.querySelector('#prompt');return e.clientHeight>120&&e.scrollHeight>e.clientHeight;});
     const grown=(await prompt.boundingBox()).height;assert(grown>initial+40&&grown<=220);
     if(width===390)await page.setViewportSize({width,height:600});
     const send=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();assert(send.y+send.height<=(width===390?600:900));
     await page.screenshot({path:path.join(output,`harness-long-${width}-${theme}.png`),fullPage:true});await audit(page);
     await prompt.fill('');await page.waitForFunction(h=>document.querySelector('#prompt').clientHeight<=h+2,initial);
     assert(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled());
     await prompt.fill('字'.repeat(15999));await prompt.press('End');await prompt.pressSequentially('abcd');assert.equal((await prompt.inputValue()).length,16000);
    }finally{await context.close();}
   }
  });
  await check('harness-files-disabled-and-composition',async()=>{
   const {context,page,state}=await open('agent');try {
    await preparePi(page);const prompt=page.getByRole('textbox',{name:'输入问题',exact:true});await prompt.fill('保留草稿');assert.equal(state.runs.length,40);
    await prompt.evaluate(e=>{const d=new DataTransfer();d.items.add(new File(['fixture'],'test.png',{type:'image/png'}));e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));});
    await page.locator('.composer-notice').waitFor();assert.equal(await page.getByAltText('待发送图片 1',{exact:true}).count(),0);assert.equal(await prompt.inputValue(),'保留草稿');
    await page.locator('[data-slot="prompt-input"]').evaluate(e=>{const d=new DataTransfer();d.items.add(new File(['fixture'],'test.txt',{type:'text/plain'}));e.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));});assert.equal(state.chatCalls,0);assert.equal(state.runs.length,40);
    await preparePi(page);await prompt.fill('输入法完成后再发送');
    await prompt.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await prompt.press('Enter');assert.equal(state.runs.length,40);
    await prompt.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await prompt.evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true})));assert.equal(state.runs.length,40);
    await prompt.press('Enter');await page.getByText('已读取示例项目。',{exact:true}).waitFor();assert.equal(state.runs.length,41);
   }finally{await context.close();}
  });
  await check('harness-controlled-drafts-and-new-focus',async()=>{
   const {context,page}=await open('chat',{legacy:[{id:'sender-draft-a',title:'组件草稿A',messages:[]}]});try {
    const prompt=page.getByRole('textbox',{name:'输入问题',exact:true});
    await page.locator('button.session').filter({hasText:'组件草稿A'}).click();await prompt.fill('第一份未发送草稿');
    await page.getByRole('button',{name:'新建对话',exact:true}).click();await focused(prompt);assert.equal(await prompt.inputValue(),'');await prompt.fill('第二份未发送草稿');
    await page.locator('button.session').filter({hasText:'组件草稿A'}).click();assert.equal(await prompt.inputValue(),'第一份未发送草稿');
    await prompt.press('Shift+Enter');assert((await prompt.inputValue()).includes('\n'));
   }finally{await context.close();}
  });
 }
 if(!live) {
  await check('pi-live-stream-before-completion-and-quiet-success',async()=>{
   const {context,page,state}=await open('chat');try{
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('STREAM WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const answer=page.locator('.agent-answer');await answer.filter({hasText:'实时片段一'}).waitFor();assert.equal(state.runs[0].phase,'running');assert.equal(await answer.getAttribute('data-complete'),'false');
    await answer.filter({hasText:'实时片段二'}).waitFor();assert.equal(state.runs[0].phase,'running');await page.screenshot({path:path.join(output,'pi-stream-partial.png'),fullPage:true});
    await page.locator('.agent-answer[data-complete=true]').waitFor();assert.equal(await answer.count(),1);assert.equal(await page.locator('.unified-agent-turn .agent-tool,.unified-agent-turn .hook-summary,.unified-agent-turn .turn-audit,.unified-agent-turn .agent-phase').count(),0);await audit(page);await page.screenshot({path:path.join(output,'pi-quiet-completed.png'),fullPage:true});
   }finally{await context.close();}
  });
  await check('pi-stream-stop-keeps-partial-out-of-context',async()=>{
   const {context,page,state}=await open('agent');try{
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('STREAM WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.locator('.agent-answer').filter({hasText:'实时片段一'}).waitFor();await page.getByRole('button',{name:'停止回答',exact:true}).click();await page.getByText('本轮已停止。',{exact:true}).waitFor();assert.equal(state.runs[0].phase,'cancelled');assert(!state.runs[0].events.some(e=>e.type==='answer'));
    const storage=await page.evaluate(()=>JSON.parse(localStorage.getItem('orion-workspace-sessions-v1')));assert(storage.some(s=>s.messages.some(m=>m.runId===state.runs[0].id&&m.excluded)));await audit(page);
   }finally{await context.close();}
  });
  await check('pi-stream-refresh-recovers-once',async()=>{
   const {context,page,state}=await open('agent');try{
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('STREAM WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.locator('.agent-answer').filter({hasText:'实时片段一'}).waitFor();const id=state.runs[0].id;
    await page.reload();await page.locator('.agent-answer[data-complete=true]').waitFor();assert.equal(state.runs[0].id,id);assert.equal(await page.locator('.agent-answer').count(),1);assert.equal((await page.locator('.agent-answer').textContent()).split('实时片段一').length,2);await audit(page);
   }finally{await context.close();}
  });
  await check('agent-scope-is-visible-and-actually-submitted',async()=>{
   const {context,page,state}=await open('chat',{width:390});try{
    const trigger=()=>page.getByRole('button',{name:/^选择回答模型，当前 Auto/});
    await trigger().click();await page.getByRole('radio',{name:/仅本地/}).check();await page.keyboard.press('Escape');await page.getByText('Auto · 仅本地',{exact:true}).waitFor();
    await page.getByLabel('输入问题',{exact:true}).fill('仅本地范围');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.lastChat.scope,'local');
    await trigger().click();await page.getByRole('radio',{name:/允许云端/}).check();await page.keyboard.press('Escape');await page.getByText('Auto · 允许云端',{exact:true}).waitFor();
    await preparePi(page);await trigger().click();assert.equal(await page.getByRole('radio',{name:/允许云端/}).count(),1);await page.getByRole('radio',{name:/仅本地/}).check();assert(await page.getByRole('option',{name:/^DeepSeek/}).isDisabled());await page.keyboard.press('Escape');await page.getByText('Auto · 仅本地',{exact:true}).waitFor();
    await page.getByLabel('输入问题',{exact:true}).fill('本地项目读取');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('已读取示例项目。',{exact:true}).waitFor();assert.equal(state.lastAgent.scope,'local');assert.equal(state.runs[0].selected,'standard');
    await trigger().click();await page.getByRole('radio',{name:/允许云端/}).check();await page.keyboard.press('Escape');await page.getByLabel('输入问题',{exact:true}).fill('COMPLEX 项目分析');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.locator('.agent-answer').nth(1).waitFor();assert.equal(state.lastAgent.scope,'hybrid');assert.equal(state.runs[0].selected,'cloud');await audit(page);
   }finally{await context.close();}
  });
  await check('observed-progress-and-consistent-answer-actions',async()=>{
   const {context,page,state}=await open('agent',{width:390,clipboardFixture:true});try{
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByText('正在思考…',{exact:true}).waitFor();const r=state.runs[0];r.events.push({seq:3,type:'tool_start',at:new Date().toISOString(),data:{id:'progress-read',tool:'read_file',args:{path:'README.md',query:'DO_NOT_EXPOSE'}}});
    await page.getByText('正在读取文件 · README.md…',{exact:true}).waitFor();assert.equal(await page.getByText('DO_NOT_EXPOSE',{exact:true}).count(),0);assert.equal(await page.locator('.unified-agent-turn .agent-tool').count(),0);
    r.events.push({seq:4,type:'tool_end',at:new Date().toISOString(),data:{id:'progress-read',tool:'read_file',result:'Fixture result'}});await page.getByText('正在整理回答…',{exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'observed-progress-mobile.png'),fullPage:true});
    r.events.push({seq:5,type:'answer',at:new Date().toISOString(),data:{text:'可复制的项目回答'}});r.phase='completed';await page.getByText('可复制的项目回答',{exact:true}).waitFor();await page.getByRole('button',{name:'复制',exact:true}).click();assert.equal(await page.evaluate(()=>window.__fixtureCopied),'可复制的项目回答');assert.equal(await page.locator('.waiting-feedback').count(),0);
    await page.getByRole('button',{name:'展开执行详情',exact:true}).click();const advanced=page.locator('.execution-advanced');assert.equal(await advanced.getAttribute('open'),null);assert(await page.locator('.agent-tool').first().isVisible());assert.equal(await page.locator('.execution-fields').isVisible(),false);await audit(page);await page.screenshot({path:path.join(output,'progressive-details-mobile.png'),fullPage:true});
   }finally{await context.close();}
  });
  await check('stopped-task-restores-draft-without-replaying-tools',async()=>{
   const {context,page,state}=await open('agent');try{
    await preparePi(page);const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('WAIT 恢复任务');await prompt.press('Enter');await page.getByRole('button',{name:'停止回答',exact:true}).click();await page.getByText('本轮已停止。',{exact:true}).waitFor();
    const restore=page.getByRole('button',{name:'编辑后重发',exact:true});await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();await prompt.fill('请保留我的新草稿');await restore.click();assert.equal(await prompt.inputValue(),'请保留我的新草稿');await prompt.fill('');await restore.click();assert.equal(await prompt.inputValue(),'WAIT 恢复任务');assert.equal(await page.locator('.agent-mode-label').count(),0);assert.equal(state.runs.length,41);await audit(page);
   }finally{await context.close();}
  });
  await check('approval-long-diff-keeps-actions-reachable',async()=>{
   const {context,page,state}=await open('agent',{width:390});try{
    await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('修改 demo.py APPROVAL WAIT');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('region',{name:'待审批操作'}).waitFor();
    const r=state.runs[0];r.approval.before=Array.from({length:100},(_,i)=>'old '+i).join('\n');r.approval.after=Array.from({length:120},(_,i)=>'new '+i).join('\n');r.events.push({seq:5,type:'state',at:new Date().toISOString(),data:{phase:'awaiting_approval'}});
    await page.getByText('1 个文件 · 新增 120 行，删除 100 行',{exact:true}).waitFor();const preview=page.locator('.approval-preview');assert(await preview.evaluate(e=>e.scrollHeight>e.clientHeight));const allow=page.getByRole('button',{name:'允许本次',exact:true});await allow.scrollIntoViewIfNeeded();const ab=await allow.boundingBox();assert(ab.y>=0&&ab.y+ab.height<=844);assert.equal(state.runs[0].phase,'awaiting_approval');await audit(page);await page.screenshot({path:path.join(output,'approval-long-mobile.png'),fullPage:true});await page.getByRole('button',{name:'拒绝',exact:true}).click();
   }finally{await context.close();}
  });
  await check('history-groups-and-inline-rename-retain-selection',async()=>{
   // Empty new workspaces intentionally have no history row after the UX update.
   // Start with a real selected conversation and rename a different history row.
   const legacy=[{id:'a'.repeat(32),title:'当前查看的历史对话',messages:[{id:'rename-history-user',role:'user',content:'保留当前选择'},{id:'rename-history-answer',role:'assistant',content:'历史回答'}]}];
   const {context,page}=await open('chat',{legacy});try{
    await page.locator('.session-group-label').filter({hasText:'今天'}).waitFor();const row=page.locator('.session-entry').filter({has:page.locator('button.session',{hasText:'Pi 历史任务'})}).first();const prior=await page.locator('button.session[aria-current=page]').getAttribute('title');await row.hover();await row.getByRole('button',{name:/对话选项/}).click();await page.getByRole('button',{name:'重命名对话',exact:true}).click();await page.getByLabel('对话名称',{exact:true}).fill('我的项目分析');await page.getByRole('button',{name:'保存名称',exact:true}).click();await page.locator('button.session').filter({hasText:'我的项目分析'}).waitFor();assert.equal(await page.locator('button.session[aria-current=page]').getAttribute('title'),prior);await audit(page);
   }finally{await context.close();}
  });
  await check('model-load-confirmation-focus-without-loading',async()=>{
   for(const width of [1440,390]){
    const {context,page,state}=await open('chat',{width});try{
     state.largeReady=false;await page.reload();await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();
     await page.getByRole('button',{name:/^选择回答模型，当前 Auto/}).click();await page.getByRole('option',{name:/Qwen3.8-27B/}).click();const dialog=page.getByRole('dialog',{name:'切换后摩模型',exact:true});await dialog.waitFor();await page.waitForFunction(e=>e.contains(document.activeElement),await dialog.elementHandle());await audit(page);await page.keyboard.press('Escape');await page.getByRole('button',{name:/^选择回答模型，当前 Auto/}).waitFor();assert.equal(state.chatCalls,0);
    }finally{await context.close();}
   }
  });
  await check('compact-sidebar-rail-and-conversation-search-shortcuts',async()=>{
   const legacy=[{id:'b'.repeat(32),title:'侧栏示例',messages:[{id:'sidebar-user',role:'user',content:'可搜索的正文线索'},{id:'sidebar-answer',role:'assistant',content:'示例回答'}]}];
   const {context,page,state}=await open('chat',{legacy});try{
    const row=page.locator('button.session').filter({hasText:'侧栏示例'});assert((await row.boundingBox()).height<=40);
    await page.getByRole('button',{name:'收起导航',exact:true}).click();await page.getByRole('button',{name:'新建对话',exact:true}).waitFor();await audit(page);
    await page.getByRole('button',{name:'搜索对话记录',exact:true}).click();const search=page.getByLabel('搜索对话',{exact:true});await focused(search);await search.fill('正文线索');assert.equal(await page.locator('button.session').count(),1);await row.waitFor();await search.press('Escape');assert.equal(await search.inputValue(),'');
    await page.getByRole('button',{name:'收起导航',exact:true}).click();await page.keyboard.press('Control+k');await focused(search);assert(await page.getByRole('button',{name:'收起导航',exact:true}).isVisible());
    await search.press('Escape');await page.keyboard.press('Control+Shift+o');assert.equal(await page.getByRole('heading',{name:'新对话',exact:true,level:1}).count(),1);await focused(page.getByLabel('输入问题',{exact:true}));assert.equal(state.chatCalls,0);await audit(page);
   }finally{await context.close();}
  });
  for(const width of [1440,390])await check(`chat-preferences-survive-reload-without-submission-${width}`,async()=>{
   const {context,page,state}=await open('chat',{width});try{
    const switches=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/switch')switches.push(request.url());});
    const picker=()=>page.getByRole('button',{name:/^选择回答模型，当前 /});
    await picker().click();await page.getByRole('radio',{name:/^仅本地/}).check();await page.getByRole('option',{name:/^Qwen3.5-9B/}).click();
    await page.reload();await picker().filter({hasText:'Qwen3.5-9B'}).waitFor();await picker().click();assert(await page.getByRole('radio',{name:/^仅本地/}).isChecked());
    await page.getByRole('radio',{name:/^允许云端/}).check();await page.getByRole('option',{name:/^DeepSeek/}).click();
    await page.reload();await picker().filter({hasText:'DeepSeek'}).waitFor();await picker().click();assert(await page.getByRole('radio',{name:/^允许云端/}).isChecked());await page.keyboard.press('Escape');
    await page.evaluate(()=>localStorage.setItem('orion-chat-preferences-v1',JSON.stringify({mode:'cloud',scope:'local'})));
    await page.reload();await picker().filter({hasText:'Auto'}).waitFor();await picker().click();assert(await page.getByRole('radio',{name:/^仅本地/}).isChecked());assert(await page.getByRole('option',{name:/^DeepSeek/}).isDisabled());await page.keyboard.press('Escape');
    assert.equal(state.chatCalls,0);assert.deepEqual(switches,[]);await audit(page);
   }finally{await context.close();}
  });
  for(const width of [1440,390])await check(`inactive-chat-draft-protects-reload-and-cleared-editor-does-not-${width}`,async()=>{
   const title='离开保护的历史会话',legacy=[{id:'e'.repeat(32),title,messages:[{id:'unload-user',role:'user',content:'合成历史'},{id:'unload-answer',role:'assistant',content:'合成回答'}]}];
   const {context,page,state}=await open('chat',{width,legacy});try{
    const prompt=page.getByLabel('输入问题',{exact:true});
    async function newChat(){if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'新建对话',exact:true}).click();}
    await newChat();await prompt.fill('切出会话仍需提醒的未发送草稿');
    if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.locator('button.session').filter({hasText:title}).click();assert.equal(await prompt.inputValue(),'');
    assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
    const dialog=page.waitForEvent('dialog',{timeout:10000});await page.evaluate(()=>{setTimeout(()=>location.reload(),0);});const warning=await dialog;assert.equal(warning.type(),'beforeunload');await warning.dismiss();
    await newChat();assert.equal(await prompt.inputValue(),'切出会话仍需提醒的未发送草稿');
    await prompt.fill('');assert(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))));
    assert.equal(state.chatCalls,0);await audit(page);
   }finally{await context.close();}
  });
  await check('conversation-drafts-restore-files-mode-and-model',async()=>{
   const legacy=[{id:'d'.repeat(32),title:'已发送的项目对话',project:'demo',boundProject:'demo',messages:[{id:'draft-history-user',role:'user',content:'之前的项目问题'},{id:'draft-history-answer',role:'assistant',content:'之前的项目回答'}]}];
   const {context,page}=await open('chat',{legacy});try{
    await preparePi(page);const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('保留项目草稿');const id=new URL(page.url()).searchParams.get('conversation');
    await page.getByRole('button',{name:'添加上下文',exact:true}).click();await page.getByRole('checkbox',{name:'README.md',exact:true}).check();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/^选择回答模型，当前 Auto/}).click();await page.getByRole('option',{name:/Qwen3.5-9B/}).click();
    await page.getByRole('button',{name:'新建对话',exact:true}).click();await prompt.fill('另一份草稿');
    await page.locator('button.session[data-conversation-id="'+id+'"]').click();assert.equal(new URL(page.url()).searchParams.get('conversation'),id);assert.equal(await prompt.inputValue(),'保留项目草稿');assert.equal(await page.locator('.agent-mode-label').count(),0);await page.getByRole('button',{name:'选择回答模型，当前 Qwen3.5-9B',exact:true}).waitFor();await page.getByRole('button',{name:'移除文件 README.md',exact:true}).waitFor();
    await page.locator('button.session[aria-current=page]').click();await page.getByRole('button',{name:'移除文件 README.md',exact:true}).waitFor();assert.equal(await prompt.inputValue(),'保留项目草稿');await audit(page);
   }finally{await context.close();}
  });
  await check('narrow-mobile-search-and-toolbar-stay-reachable',async()=>{
   const {context,page,state}=await open('chat',{width:390});try{
    await page.setViewportSize({width:320,height:568});await page.keyboard.press('Control+k');const dialog=page.getByRole('dialog',{name:'工作台导航',exact:true});await dialog.waitFor();const search=dialog.getByLabel('搜索对话',{exact:true});await focused(search);await search.fill('没有匹配');await search.press('Escape');assert.equal(await search.inputValue(),'');assert(await dialog.isVisible());await audit(page);await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('较长的输入\n'.repeat(12));for(const name of ['添加上下文','添加图片','发送消息']){const target=page.getByRole('button',{name,exact:true});const box=await target.boundingBox();assert(box.x>=0&&box.x+box.width<=320&&box.y+box.height<=568,JSON.stringify({name,box}));}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await page.screenshot({path:path.join(output,'composer-narrow-mobile.png'),fullPage:true});assert.equal(state.chatCalls,0);
   }finally{await context.close();}
  });
  await check('pending-admission-does-not-clear-another-conversation-draft',async()=>{
   const {context,page,state}=await open('agent');let release;
   try{
    await preparePi(page);const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('WAIT 保留异步草稿');
    const gate=new Promise(resolve=>{release=resolve;});await context.route('**/api/agent/runs',async route=>{if(route.request().method()==='POST')await gate;return state.handle(route);});
    await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:'新建对话',exact:true}).click();await prompt.fill('新会话草稿不能被清空');release();await page.getByText('另一会话正在执行，结束后可发送新消息。',{exact:true}).waitFor();assert.equal(await prompt.inputValue(),'新会话草稿不能被清空');await page.getByRole('button',{name:'停止回答',exact:true}).click();
   }finally{release?.();await context.close();}
  });
  await check('harness-admission-failure-retains-draft',async()=>{
   const {context,page}=await open('agent');try{
    await preparePi(page);const input=page.getByLabel('输入问题',{exact:true});await input.fill('ADMISSION_FAIL');await input.press('Enter');await page.getByText('另一个任务正在处理，请稍后重试。',{exact:true}).waitFor();assert.equal(await input.inputValue(),'ADMISSION_FAIL');
   }finally{await context.close();}
  });
 }
 if(!live)for(const width of [1440,390])for(const theme of ['light','dark'])await check(`auto-decision-picker-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('chat',{width,theme});try{
   const trigger=()=>page.getByRole('button',{name:/^选择回答模型，当前 /});await trigger().click();const engines=page.getByRole('group',{name:'Auto 决策模型',exact:true});await engines.waitFor();assert.equal(await engines.getByRole('radio').count(),3);assert(await engines.getByRole('radio',{name:/Qwen3.5-2B/}).isChecked());assert.equal(await page.getByText('GLiNER',{exact:true}).count(),0);
   const fourth=engines.getByRole('radio',{name:/Qwen3.5-4B/});await fourth.check();await page.getByRole('radio',{name:/仅本地/}).check();await audit(page);await page.screenshot({path:path.join(output,`decision-picker-${width}-${theme}.png`),fullPage:true});await page.keyboard.press('Escape');await focused(trigger());await page.locator('.decision-caption').filter({hasText:'Qwen3.5-4B'}).waitFor();
   await page.getByLabel('输入问题',{exact:true}).fill('DECISION_FIXTURE');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.lastChat.decision_engine,'qwen35-4b-houmo');assert.equal(state.lastChat.scope,'local');assert.equal(state.lastChat.mode,'auto');
   await trigger().click();await page.getByRole('option',{name:/^Qwen3.5-9B/}).click();await trigger().click();assert.equal(await page.getByRole('group',{name:'Auto 决策模型',exact:true}).count(),0);assert(await page.getByRole('option',{name:/^DeepSeek/}).isDisabled());await page.getByRole('option',{name:/^Auto/}).click();await trigger().click();assert(await page.getByRole('group',{name:'Auto 决策模型',exact:true}).getByRole('radio',{name:/Qwen3.5-4B/}).isChecked());await page.keyboard.press('Escape');
   await preparePi(page);await page.getByLabel('输入问题',{exact:true}).fill('读取示例说明');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('已读取示例项目。',{exact:true}).waitFor();assert.equal(state.lastAgent.decision_engine,'qwen35-4b-houmo');assert.equal(state.lastAgent.scope,'local');
   await page.reload();await page.getByLabel('输入问题',{exact:true}).waitFor();await trigger().click();assert(await page.getByRole('group',{name:'Auto 决策模型',exact:true}).getByRole('radio',{name:/Qwen3.5-4B/}).isChecked());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);
  }finally{await context.close();}
 });

 if(!live)await check('retired-evaluations-redirect-without-loading-test-data',async()=>{
  const {context,page}=await open('resources');try{
   const fetched=[];page.on('request',r=>fetched.push(r.url()));
   for(const route of ['overview','comparison','records','controlled','decisions','decision-routing','gliner-clarification','routing','agent-routing','agent-protocol','protocol']) {
    const url=new URL(dashboard);url.hash=route;await page.goto(url.href);await page.getByRole('heading',{name:'资源监控',exact:true,level:1}).waitFor();assert.equal(new URL(page.url()).hash,'#resources');
   }
   assert.equal(fetched.filter(u=>/\/data\.json|\/assets\/.*\.(?:json|xlsx|csv|txt)/.test(u)).length,0);
   assert.equal(await page.getByRole('link',{name:'模型评测',exact:true}).count(),0);
  }finally{await context.close();}
 });
 if(!live)await check('session-denial-and-retry-preserve-draft-without-sending',async()=>{
  const {context,page,state}=await open('chat',{width:390});try{
   let replyStatus=503;
   await context.route('**/api/session',route=>replyStatus===200?state.handle(route):route.fulfill({status:replyStatus,contentType:'application/json',body:JSON.stringify({authorized:false,error:'Fixture session unavailable or denied'})}));
   await page.reload();await page.getByRole('status',{name:'会话连接失败',exact:true}).waitFor();
   await page.getByText('暂时无法建立设备会话',{exact:true}).waitFor();const prompt=page.getByLabel('输入问题',{exact:true});await prompt.fill('重新检查权限时保留的草稿');
   replyStatus=403;await page.getByRole('button',{name:'重新检查权限',exact:true}).click();await page.getByRole('status',{name:'设备未授权',exact:true}).waitFor();await page.getByText('此设备尚未获得聊天权限',{exact:true}).waitFor();assert.equal(await prompt.inputValue(),'重新检查权限时保留的草稿');
   assert(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled());assert.equal(state.chatCalls,0);await audit(page);
   await page.screenshot({path:path.join(output,'chat-permission-mobile.png'),fullPage:true});
   replyStatus=200;await page.getByRole('button',{name:'重新检查权限',exact:true}).click();await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();
   assert.equal(await prompt.inputValue(),'重新检查权限时保留的草稿');assert(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled());assert.equal(state.chatCalls,0);await audit(page);
  }finally{await context.close();}
 });
 if(!live)await check('initial-resource-failure-never-claims-a-retained-sample-and-retry-recovers',async()=>{
  const {context,page,state}=await open('resources');try{
   let failing=true;
   await context.route('**/api/resources',route=>failing?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture resource unavailable'})}):state.handle(route));
   await page.reload();await page.getByText('暂时无法读取资源指标',{exact:true}).waitFor();
   assert.equal(await page.getByText(/保留最后一次采样|已保留当前可用内容/).count(),0);assert.equal(await page.locator('.resource-metric').count(),0);await audit(page);
   failing=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.resource-metric').first().waitFor();assert.equal(await page.getByText('暂时无法读取资源指标',{exact:true}).count(),0);await audit(page);
  }finally{await context.close();}
 });
 if(!live)await check('basilos-v2-resource-history-and-refresh-retain-real-data',async()=>{
  const {context,page,state}=await open('resources');let release;
  try{
   let history=[],missing=false,slow=false,requests=0;
   await context.route('**/api/resources',route=>state.handle({
    request:()=>route.request(),
    fulfill:async options=>{
     requests++;const data=JSON.parse(options.body);data.history=history;data.sample.cpu=missing?null:0;
     if(slow)await new Promise(resolve=>{release=resolve;});
     return route.fulfill({...options,body:JSON.stringify(data)});
    }
   }));
   await page.reload();const cpu=page.getByRole('group',{name:'CPU · 整机占用',exact:true});
   await cpu.getByText('0.0%',{exact:true}).waitFor();assert.equal(await cpu.getByRole('img').count(),0);
   assert.equal(await cpu.getByText('暂无历史采样',{exact:true}).count(),1);
   const refresh=()=>resourceAction(page,'刷新资源数据');
   const point=(seconds,cpu)=>({timestamp:new Date(Date.UTC(2026,9,28,0,0,seconds)).toISOString(),cpu,ram_available:null,temperature:null});
   history=[point(0,0),point(10,20)];await refresh();await cpu.getByText('等待连续采样',{exact:true}).waitFor();assert.equal(await cpu.getByRole('img').count(),0);
   history=[point(0,0),point(1,20)];await refresh();await cpu.getByRole('img',{name:'CPU 占用趋势，最近 2 个真实采样',exact:true}).waitFor();
   missing=true;await refresh();await cpu.getByText('N/A',{exact:true}).waitFor();await audit(page);
   slow=true;await refresh();await page.waitForFunction(()=>document.querySelector('.resource-data').getAttribute('aria-busy')==='true');
   const pendingRequests=requests;const pendingMenu=await openResourceMenu(page);assert(await pendingMenu.getByRole('menuitem',{name:'刷新资源数据',exact:true}).isDisabled());await page.keyboard.press('Escape');assert.equal(await page.locator('.resource-loading').count(),0);await cpu.getByText('N/A',{exact:true}).waitFor();
   await page.waitForTimeout(1200);assert.equal(requests,pendingRequests,'Refresh overlapped a pending resource request');
   slow=false;release();release=null;await waitResourceIdle(page);
   await page.screenshot({path:path.join(output,'basilos-v2-resource-states.png'),fullPage:true});
  }finally{release?.();await context.close();}
 });
 if(!live)await check('basilos-v2-metric-grid-follows-content-width',async()=>{
  const {context,page}=await open('resources',{width:1200});try{
   const cards=page.locator('.resource-metric');await cards.first().waitFor();
   const expanded=await cards.evaluateAll(elements=>elements.map(e=>({top:e.getBoundingClientRect().top,left:e.getBoundingClientRect().left})));
   assert(expanded[2].top>expanded[0].top,'Expanded sidebar should leave room for two metric columns');
   await page.screenshot({path:path.join(output,'basilos-v2-resources-expanded.png'),fullPage:true});
   await page.getByRole('button',{name:'收起导航',exact:true}).click();
   await page.waitForFunction(()=>{const cards=[...document.querySelectorAll('.resource-metric')];return cards.length===4&&Math.abs(cards[0].getBoundingClientRect().top-cards[3].getBoundingClientRect().top)<1;});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);
   await page.screenshot({path:path.join(output,'basilos-v2-resources-collapsed.png'),fullPage:true});
  }finally{await context.close();}
 });
 if(!live)for(const route of ['resources','chat'])await check(`basilos-v2-appearance-persistence-${route}`,async()=>{
  const {context,page,state}=await open(route,{width:390});try{
   const url=new URL(page.url());url.searchParams.delete('theme');await page.goto(url.href);await page.getByRole('main').waitFor();
   const settings=()=>page.getByRole('button',{name:/外观与(?:使用说明|偏好)$/}).last();
   const openSettings=async()=>{if(route==='chat')await page.getByRole('button',{name:'打开导航',exact:true}).click();await settings().click();};
   await openSettings();const dialog=page.getByRole('dialog',{name:'外观与使用说明',exact:true});await dialog.waitFor();
   await dialog.getByRole('radio',{name:'品牌橙',exact:true}).check();await dialog.getByRole('radio',{name:'紧凑',exact:true}).check();await dialog.getByRole('radio',{name:'暗色',exact:true}).check();
   await page.waitForFunction(()=>document.documentElement.dataset.accent==='orange'&&document.documentElement.dataset.density==='compact'&&document.documentElement.classList.contains('dark'));
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('basilos-ui:v2:appearance'))),{accent:'orange',density:'compact'});await audit(page);
   await page.screenshot({path:path.join(output,`v2-appearance-${route}-mobile.png`),fullPage:true});await page.keyboard.press('Escape');await page.reload();
   await page.waitForFunction(()=>document.documentElement.dataset.accent==='orange'&&document.documentElement.dataset.density==='compact'&&document.documentElement.classList.contains('dark'));
   await openSettings();await dialog.getByRole('radio',{name:'蓝色',exact:true}).check();await audit(page);await dialog.getByRole('button',{name:'重置外观',exact:true}).click();
   assert.equal(await page.locator('html').getAttribute('data-accent'),'neutral');assert.equal(await page.locator('html').getAttribute('data-density'),'comfortable');assert(await dialog.getByRole('radio',{name:'暗色',exact:true}).isChecked());
   assert(await dialog.getByRole('button',{name:'重置外观',exact:true}).isDisabled());assert.equal(state.chatCalls,0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])await check(`basilos-v2-real-history-chart-and-csp-${width}`,async()=>{
  const {context,page,state}=await open('resources',{width});try{
   // Synthetic observations belong only to this isolated browser fixture, never to the live page.
   const history=Array.from({length:60},(_,i)=>({timestamp:new Date(Date.UTC(2026,9,28,0,0,i)).toISOString(),cpu:i===30?null:25+Math.sin(i/8)*15,ram_available:(12+Math.cos(i/8))*1024**3,temperature:null}));
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:options=>{const data=JSON.parse(options.body);data.history=history;return route.fulfill({...options,body:JSON.stringify(data)});}}));
   await page.reload();const cpu=page.getByRole('region',{name:'CPU 使用趋势',exact:true});await cpu.locator('.recharts-area-curve').waitFor();await page.getByRole('region',{name:'可用内存趋势',exact:true}).locator('.recharts-area-curve').waitFor();
   assert.equal(await cpu.getByText('59 个采样',{exact:true}).count(),1);assert.equal(await page.locator('.resource-history-placeholder').count(),0);
   assert.deepEqual(await page.evaluate(()=>window.__senderCsp),[],'Recharts must preserve the production style CSP');
   await resourceAction(page,'暂停刷新');await audit(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(output,`v2-history-${width}-light.png`),fullPage:true});
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])await check(`resource-adaptive-axis-follows-visible-peaks-${width}`,async()=>{
  const {context,page,state}=await open('resources',{width});try{
   let peak=2.8;
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:options=>{
    const data=JSON.parse(options.body);data.history=Array.from({length:60},(_,i)=>({timestamp:new Date(Date.UTC(2026,9,29,0,0,i)).toISOString(),cpu:peak*(i%20)/19,ram_available:(8+i/59*0.3)*1024**3,temperature:40+i/59*2}));
    return route.fulfill({...options,body:JSON.stringify(data)});
   }}));
   await page.reload();const cpu=page.getByRole('region',{name:'CPU 使用趋势',exact:true});await cpu.locator('.recharts-area-curve').waitFor();
   const waitForTop=async top=>{await page.waitForFunction(top=>{const ticks=[...document.querySelectorAll('[aria-label="CPU 使用趋势"] .recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(e=>Number(e.textContent));return ticks.length===5&&Math.max(...ticks)===top;},top);};
   await waitForTop(4);assert.deepEqual(await cpu.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').allTextContents(),['0','1','2','3','4']);
   const micro=page.getByRole('group',{name:'CPU · 整机占用',exact:true}).locator('.recharts-area-curve');assert(await micro.evaluate(e=>e.getBBox().height)>12,'Low readings should remain visible in the overview sparkline');
   const refresh=()=>resourceAction(page,'刷新资源数据');
   for(const [next,top]of [[7,10],[0,1],[95,100],[0.7,1],[2.8,4]]){peak=next;await refresh();await waitForTop(top);}
   const ram=page.getByRole('region',{name:'可用内存趋势',exact:true});assert.equal(await ram.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').last().textContent(),'10');
   assert.deepEqual(await page.evaluate(()=>window.__senderCsp),[]);await audit(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('.resource-history-grid').screenshot({path:path.join(output,`resource-adaptive-axis-${width}.png`)});
  }finally{await context.close();}
 });
 if(!live)for(const width of [1344,390])await check(`resource-refresh-controls-and-stable-clock-${width}`,async()=>{
  const {context,page,state}=await open('resources',{width});let release;
  try{
   let holding=false,stamp='2026-10-29T01:01:11Z';const gate=new Promise(resolve=>{release=resolve;});
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:async options=>{const data=JSON.parse(options.body);data.sample.timestamp=stamp;if(holding)await gate;return route.fulfill({...options,body:JSON.stringify(data)});}}));
   await page.reload();const frequency=page.getByRole('radiogroup',{name:'刷新频率',exact:true});await frequency.getByRole('radio',{name:'5 秒',exact:true}).check();
   await page.locator('.resource-update-status time').filter({hasText:'09:01:11'}).waitFor();await waitResourceIdle(page);
   const status=page.locator('.resource-update-status'),before=await status.boundingBox(),cardsBefore=await page.locator('.resource-stats').boundingBox();
   holding=true;stamp='2026-10-29T03:11:11Z';await resourceAction(page,'刷新资源数据');await page.waitForFunction(()=>document.querySelector('.resource-data').getAttribute('aria-busy')==='true');
   assert.match(await status.innerText(),/最近采样\s*09:01:11/);const pending=await status.boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-pending[key])<0.5,'Clock moved while polling: '+key);
   holding=false;release();await status.locator('time').filter({hasText:'11:11:11'}).waitFor();const after=await status.boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-after[key])<0.5,'Clock moved after timestamp update: '+key);
   assert(Math.abs((await page.locator('.resource-stats').boundingBox()).y-cardsBefore.y)<0.5);
   await frequency.getByRole('radio',{name:'2 秒',exact:true}).check();assert(await frequency.getByRole('radio',{name:'2 秒',exact:true}).isChecked());
   await frequency.getByRole('radio',{name:'2 秒',exact:true}).focus();await page.keyboard.down('ArrowRight');try{await page.waitForFunction(()=>document.querySelector('#resource-interval-5').getAttribute('aria-checked')==='true');}finally{await page.keyboard.up('ArrowRight');}assert(await frequency.getByRole('radio',{name:'5 秒',exact:true}).isChecked());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await page.screenshot({path:path.join(output,`resource-polish-${width}.png`),fullPage:false});
  }finally{release?.();await context.close();}
 });
 if(!live)for(const width of [1440,390])await check(`shell-footer-single-settings-and-layout-${width}`,async()=>{
  for(const route of ['resources','chat'])for(const theme of ['light','dark']){
   const {context,page,state}=await open(route,{width,theme});try{
    if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();const footer=page.locator('.shell-sidebar-footer');await footer.waitFor();
    const settings=footer.getByRole('button',{name:/外观与偏好$/});assert.equal(await settings.count(),1,'Footer must have one workspace settings entry');
    const gatewayLink=footer.getByRole('link',{name:'AI Gateway 控制台',exact:true});assert.equal(await gatewayLink.getAttribute('target'),'_blank');assert.match(await gatewayLink.getAttribute('rel'),/noopener/);
    await footer.getByText('外观与偏好',{exact:true}).waitFor();const bounds=await settings.boundingBox();assert(bounds.height>=44&&bounds.x>=0&&bounds.x+bounds.width<=width);
    await audit(page);await page.screenshot({path:path.join(output,`footer-${route}-${width}-${theme}.png`),fullPage:false});
    await settings.click();await page.getByRole('dialog',{name:'外观与使用说明',exact:true}).waitFor();await page.keyboard.press('Escape');
    if(width===1440){await page.getByRole('button',{name:'收起导航',exact:true}).click();assert.equal(await footer.locator('.device-description').isVisible(),false);const icon=await footer.locator('.device-avatar').boundingBox();assert(icon.x>=0&&icon.x+icon.width<=64);await audit(page);}
    assert.equal(state.chatCalls,0);
   }finally{await context.close();}
  }
 });
 if(!live)for(const width of [1442,390,320])await check(`resource-overflow-menu-actions-${width}`,async()=>{
  const {context,page,state}=await open('resources',{width});let release;
  try{
   const gate=new Promise(resolve=>{release=resolve;});let holding=false;
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:async options=>{if(holding)await gate;return route.fulfill(options);}}));
   await waitResourceIdle(page);const actions=page.getByRole('group',{name:'资源监控操作',exact:true}),more=actions.getByRole('button',{name:'更多资源操作',exact:true});assert.equal(await actions.getByRole('button').count(),1);assert.equal(await page.locator('.page-header').getByRole('button').count(),0);assert.equal(await page.getByRole('button',{name:'保存快照',exact:true}).count(),0);
   const frequencyBox=await page.getByRole('radiogroup',{name:'刷新频率',exact:true}).boundingBox(),moreBox=await more.boundingBox();assert(moreBox.x>=frequencyBox.x+frequencyBox.width,'More must stay to the right of 1/2/5 seconds');assert(Math.abs(moreBox.y+moreBox.height/2-frequencyBox.y-frequencyBox.height/2)<1,'More must align with the frequency selector');
   await more.focus();await page.keyboard.press('Enter');let menu=page.getByRole('menu',{name:'更多资源操作',exact:true});await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),3);assert(await menu.getByRole('menuitem',{name:'保存快照',exact:true}).isEnabled());const menuBox=await menu.boundingBox();assert(menuBox.x>=0&&menuBox.x+menuBox.width<=width);await audit(page);await page.screenshot({path:path.join(output,`resource-menu-open-${width}.png`),fullPage:false});await page.keyboard.press('Escape');await focused(more);
   holding=true;await resourceAction(page,'刷新资源数据');await page.waitForFunction(()=>document.querySelector('.resource-data').getAttribute('aria-busy')==='true');menu=await openResourceMenu(page);assert(await menu.getByRole('menuitem',{name:'刷新资源数据',exact:true}).isDisabled());await page.keyboard.press('Escape');holding=false;release();await waitResourceIdle(page);
   await resourceAction(page,'暂停刷新');await page.getByText('已暂停页面刷新，当前数值为保留快照。',{exact:true}).waitFor();menu=await openResourceMenu(page);assert(await menu.getByRole('menuitem',{name:'刷新资源数据',exact:true}).isDisabled());assert(await menu.getByRole('menuitem',{name:'继续刷新',exact:true}).isEnabled());await page.keyboard.press('Escape');
   const pending=page.waitForEvent('download');await resourceAction(page,'保存快照');const download=await pending;assert.match(download.suggestedFilename(),/^O6N资源快照-/);const receipt=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(receipt.view_status,'paused');assert(receipt.sample);
   await resourceAction(page,'继续刷新');await waitResourceIdle(page);assert(await more.isVisible());assert.equal(await actions.getByRole('button').count(),1);assert.equal(state.chatCalls,0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await page.locator('.resource-toolbar').screenshot({path:path.join(output,`resource-actions-${width}.png`)});
  }finally{release?.();await context.close();}
 });
 if(!live)for(const width of [1442,390])for(const theme of ['light','dark'])await check(`resource-device-panels-data-and-layout-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('resources',{width,theme});try{
   let mode='ready';
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:options=>{
    const data=JSON.parse(options.body),sample=data.sample;
    const card={bdf:'0000:01:00.0',model:'测试加速卡',width:'4',link:'16 GT/s',smi_ok:mode!=='stale',smi_age:0,ipu_load:0,core_util:[0,12.5],memory_total:8*1024**3,memory_used:2*1024**3,memory_free:6*1024**3,core_temp:44,ddr_temp:42,frequency_mhz:800,power_w:8.25,driver_version:'fixture',firmware_version:'fixture'};
    if(mode==='zero'){Object.assign(card,{memory_used:0,memory_free:card.memory_total,core_temp:0,ddr_temp:0,frequency_mhz:0,power_w:0,core_util:[0,0]});}
    if(mode==='missing'){for(const key of ['ipu_load','memory_total','memory_used','memory_free','core_temp','ddr_temp','frequency_mhz','power_w'])card[key]=null;card.core_util=[null,null];}
    sample.accelerators={houmo:[card],gpu:mode==='zero'?[{name:'测试 GPU',busy:0,vram_used:0,vram_total:1024**3},{name:'测试 GPU',busy:null,vram_used:null,vram_total:null}]:[],npu:[{name:'测试 NPU',frequency:mode==='missing'?null:1e9}],aipu_loaded:true};
    sample.docker_count=0;sample.docker_memory=0;sample.swap_total=0;sample.swap_free=0;
    sample.models=Array.from({length:12},(_,i)=>({name:'测试进程 '+i,backend:'fixture',pid:1000+i,port:'',context:'',rss:0,mtp:false}));sample.model_processes=sample.models.length;
    return route.fulfill({...options,body:JSON.stringify(data)});
   }}));
   await page.reload();const board=page.getByRole('region',{name:'后摩加速卡 · 测试加速卡',exact:true});await board.waitFor();
   const load=board.getByRole('group',{name:'IPU 负载',exact:true}),memory=board.getByRole('group',{name:'卡载内存 · 已用',exact:true}),power=board.getByRole('group',{name:'板卡功耗',exact:true});
   await load.getByText('0.0%',{exact:true}).first().waitFor();assert.equal(await memory.getByRole('meter',{name:'后摩卡载内存已用百分比',exact:true}).getAttribute('aria-valuenow'),'25');await power.getByText('8.25 W',{exact:true}).waitFor();assert.equal(await board.getByRole('group').count(),4);
   const devices=page.getByRole('region',{name:'GPU / CIX NPU / 容器',exact:true});assert.equal(await devices.getByRole('group').count(),4);await devices.getByRole('group',{name:'GPU',exact:true}).getByText('N/A',{exact:true}).waitFor();await devices.getByRole('group',{name:'Docker',exact:true}).getByText('0 个',{exact:true}).waitFor();const swap=devices.getByRole('group',{name:'Swap',exact:true});await swap.getByText('未启用',{exact:true}).waitFor();assert.equal(await swap.locator('[data-slot=progress-indicator]').isVisible(),false,'An unavailable percentage must not show an indeterminate bar');
   await audit(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(width===1442){const left=await page.getByRole('region',{name:'当前模型进程',exact:true}).boundingBox(),right=await devices.boundingBox();assert(left.height>right.height+100,'Device panel must not stretch to match a long process table');}
   await board.screenshot({path:path.join(output,`accelerator-${width}-${theme}.png`)});await devices.screenshot({path:path.join(output,`system-devices-${width}-${theme}.png`)});
   const refresh=()=>resourceAction(page,'刷新资源数据');mode='zero';await refresh();await power.getByText('0.00 W',{exact:true}).waitFor();await memory.getByText('0.00 GiB',{exact:true}).waitFor();assert.equal(await memory.getByRole('meter',{name:'后摩卡载内存已用百分比',exact:true}).getAttribute('aria-valuenow'),'0');await devices.getByRole('group',{name:'GPU',exact:true}).getByText('0.0%',{exact:true}).waitFor();
   mode='missing';await refresh();await power.locator('.resource-detail-value').filter({hasText:/^N\/A$/}).waitFor();assert.equal(await memory.getByRole('meter',{name:'后摩卡载内存已用百分比',exact:true}).count(),0);assert.equal(await memory.locator('[data-slot=progress-indicator]').isVisible(),false);
   mode='stale';await refresh();await board.getByText('SMI 暂不可用',{exact:true}).waitFor();await memory.getByText('N/A',{exact:true}).first().waitFor();assert.equal(await load.getByRole('meter',{name:'后摩 IPU 负载',exact:true}).count(),0);await audit(page);assert.equal(state.chatCalls,0);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1442,390])for(const theme of ['light','dark'])await check(`resource-process-panel-data-and-responsive-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('resources',{width,theme});try{
   let mode='rows';const longName='fixture-model-'+('long-name-'.repeat(7));
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:options=>{
    const data=JSON.parse(options.body),sample=data.sample;const empty=mode==='empty'||mode==='missing';
    sample.models=empty?[]:Array.from({length:mode==='long'?12:3},(_,i)=>({name:i===0?longName:'测试模型 '+i,backend:i===0?'CPU':'测试后端',pid:1000+i,port:i===0?'17701':i===2?'00080':'',context:i===0?'4096':i===2?'0':'',rss:i===0?0:i===1?null:2*1024**3,mtp:i===2}));
    sample.model_processes=sample.models.length;sample.model_rss=mode==='missing'?null:empty?0:2*1024**3;sample.model_cpu=mode==='missing'?null:0;
    return route.fulfill({...options,body:JSON.stringify(data)});
   }}));
   await page.reload();const panel=page.getByRole('region',{name:'当前模型进程',exact:true});await panel.getByRole('group',{name:'主机 RSS 合计',exact:true}).getByText('2.00 GiB',{exact:true}).waitFor();await panel.getByRole('group',{name:'进程 CPU · 占整机',exact:true}).getByText('0.0%',{exact:true}).waitFor();
   const table=panel.getByRole('table'),rows=table.locator('tbody tr');assert.equal(await rows.count(),3);assert.equal(await rows.first().getByRole('cell').nth(2).innerText(),'0.00 GiB');assert.equal(await rows.nth(1).getByRole('cell').nth(2).innerText(),'N/A');assert.equal(await rows.nth(2).getByRole('cell').nth(3).innerText(),'0');await rows.nth(2).getByText('端口 00080',{exact:true}).waitFor();await rows.nth(2).getByText('MTP',{exact:true}).waitFor();assert((await rows.first().innerText()).includes(longName));await rows.first().getByText('PID 1000',{exact:true}).waitFor();
   const scroll=panel.getByRole('region',{name:'当前模型进程表，可横向滚动',exact:true});if(width===390){assert(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth));await panel.getByText('左右滑动查看完整表格',{exact:true}).waitFor();}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await panel.screenshot({path:path.join(output,`model-process-${width}-${theme}.png`)});
   mode='long';await resourceAction(page,'刷新资源数据');await page.waitForFunction(()=>document.querySelectorAll('.resource-model-table tbody tr').length===12);assert(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight));await scroll.focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('.resource-process-table-scroll').scrollTop>0);
   mode='empty';await resourceAction(page,'刷新资源数据');await panel.getByText('暂无可读取的模型进程',{exact:true}).waitFor();await panel.getByRole('group',{name:'主机 RSS 合计',exact:true}).getByText('0.00 GiB',{exact:true}).waitFor();assert.equal(await panel.getByRole('table').count(),0);
   mode='missing';await resourceAction(page,'刷新资源数据');await panel.getByRole('group',{name:'主机 RSS 合计',exact:true}).getByText('N/A',{exact:true}).waitFor();await panel.getByRole('group',{name:'进程 CPU · 占整机',exact:true}).getByText('N/A',{exact:true}).waitFor();await audit(page);assert.equal(state.chatCalls,0);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1442,1366,390])for(const theme of ['light','dark'])await check(`resource-overview-density-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('resources',{width,theme});try{
   // Only this isolated fixture supplies synthetic observations; production uses the actual history.
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:options=>{
    const data=JSON.parse(options.body);data.sample.disk_available=123.4*1024**3;data.sample.disk_total=256*1024**3;data.sample.disk_used=132.6*1024**3;data.history=Array.from({length:60},(_,i)=>({timestamp:new Date(Date.UTC(2026,9,29,0,0,i)).toISOString(),cpu:(i%20)/3,ram_available:8*1024**3,temperature:40+i%3}));
    return route.fulfill({...options,body:JSON.stringify(data)});
   }}));
   await page.reload();const cards=page.locator('.resource-metric');await cards.first().getByRole('img',{name:'CPU 占用趋势，最近 20 个真实采样',exact:true}).waitFor();
   const boxes=await cards.evaluateAll(elements=>elements.map(e=>{
    const card=e.getBoundingClientRect(),value=e.querySelector('.resource-value').getBoundingClientRect(),chart=e.querySelector('.resource-metric-chart').getBoundingClientRect();
    return {top:card.top,left:card.left,right:card.right,height:card.height,space:chart.left-value.right,chartWidth:chart.width,chartHeight:chart.height};
   }));
   assert.equal(boxes.length,4);for(const box of boxes){assert(box.height>=140,'Comfortable cards need breathing room');assert(box.space>=8,'Value and chart must stay apart');assert(box.chartWidth>=84&&box.chartHeight>=38,'Sparkline needs readable dimensions');}
   if(width>390){assert(boxes.every(b=>Math.abs(b.top-boxes[0].top)<1));assert(boxes[1].left-boxes[0].right>=15);}else assert(boxes[1].top>boxes[0].top);
   await page.getByRole('region',{name:'CPU 使用趋势',exact:true}).getByText('60 个采样',{exact:true}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);
   await page.locator('.resource-stats').screenshot({path:path.join(output,`resource-overview-density-${width}-${theme}.png`)});
   await page.getByRole('button',{name:/外观与(?:使用说明|偏好)$/}).last().click();const dialog=page.getByRole('dialog',{name:'外观与使用说明',exact:true});await dialog.getByRole('radio',{name:'紧凑',exact:true}).check();await page.keyboard.press('Escape');
   const compact=await cards.first().boundingBox();assert(compact.height>=124&&compact.height<boxes[0].height,'Compact preference should still reduce card height');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(state.chatCalls,0);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])for(const theme of ['light','dark'])await check(`chat-sidebar-no-draft-placeholders-${width}-${theme}`,async()=>{
  const emptyId='e'.repeat(32),historyId='a'.repeat(32),namedId='b'.repeat(32);
  const legacy=[{id:emptyId,title:'新对话',messages:[],draftOnly:true},{id:'f'.repeat(32),title:'新对话',project:'demo',boundProject:'demo',messages:[]},{id:historyId,title:'已发送的历史问题',messages:[{id:'history-q',role:'user',content:'之前的问题'},{id:'history-a',role:'assistant',content:'之前的回答'}]},{id:namedId,title:'待加载的已命名记录',messages:[]}];
  const {context,page,state}=await open('chat',{width,theme,legacy});try{
   const prompt=page.getByLabel('输入问题',{exact:true});
   const showNavigation=async()=>{if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();};
   await showNavigation();const nav=page.getByRole('navigation',{name:'最近对话',exact:true});await nav.waitFor();
   assert.equal(await nav.getByText('草稿',{exact:true}).count(),0);assert.equal(await nav.locator('button.session[title="新对话"]').count(),0);
   await nav.locator(`[data-conversation-id="${historyId}"]`).waitFor();await nav.locator(`[data-conversation-id="${namedId}"]`).waitFor();
   if(width===390){await page.keyboard.press('Escape');await page.locator('[role=dialog].mobile-sidebar').waitFor({state:'detached'});}await prompt.fill('尚未发送的输入');
   const newConversation=async()=>{if(width===390)await page.keyboard.press('Control+Shift+o');else await page.getByRole('button',{name:'新建对话',exact:true}).click();};
   for(let i=0;i<3;i++){await newConversation();await focused(prompt);assert.equal(new URL(page.url()).searchParams.get('conversation'),emptyId);assert.equal(await prompt.inputValue(),'尚未发送的输入');}
   await showNavigation();await nav.locator(`[data-conversation-id="${historyId}"]`).click();if(width===390){await page.keyboard.press('Escape');await page.locator('[role=dialog].mobile-sidebar').waitFor({state:'detached'});}await prompt.fill('历史对话里未发送的补充');
   await newConversation();assert.equal(await prompt.inputValue(),'尚未发送的输入');
   await showNavigation();await nav.locator(`[data-conversation-id="${historyId}"]`).click();if(width===390){await page.keyboard.press('Escape');await page.locator('[role=dialog].mobile-sidebar').waitFor({state:'detached'});}assert.equal(await prompt.inputValue(),'历史对话里未发送的补充');
   await newConversation();assert.equal(await prompt.inputValue(),'尚未发送的输入');assert.equal(state.chatCalls,0);
   await showNavigation();assert.equal(await nav.locator('button.session[title="新对话"]').count(),0);await audit(page);await page.screenshot({path:path.join(output,`chat-sidebar-history-${width}-${theme}.png`),fullPage:true});if(width===390){await page.keyboard.press('Escape');await page.locator('[role=dialog].mobile-sidebar').waitFor({state:'detached'});}
   const sent=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat'&&r.request().method()==='POST');await prompt.fill('发送后进入历史');await prompt.press('Enter');await sent;
   await showNavigation();await nav.locator(`[data-conversation-id="${emptyId}"]`).waitFor();assert.equal(state.chatCalls,1);assert.equal(await nav.getByText('草稿',{exact:true}).count(),0);await audit(page);
   const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('orion-workspace-sessions-v1')));assert(stored.some(s=>s.id==='f'.repeat(32)),'Existing empty records must not be deleted');
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])for(const theme of ['light','dark'])await check(`chat-sidebar-header-search-focus-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('chat',{width,theme});try{
   if(width===390)await page.getByRole('button',{name:'打开导航',exact:true}).click();
   const sidebar=page.locator('.chat-navigation:visible'),search=sidebar.getByLabel('搜索对话',{exact:true}),wrap=sidebar.locator('.session-search .search-wrap'),create=sidebar.getByRole('button',{name:'新建对话',exact:true});
   const before=await wrap.boundingBox(),newBox=await create.boundingBox();assert(Math.abs(before.x-newBox.x)<1&&Math.abs(before.width-newBox.width)<1,'Search and new chat should share edges');assert(before.y-newBox.y-newBox.height>=7,'Controls need clear separation');assert(before.height>=(width===390?44:40));
   await search.focus();await focused(search);const after=await wrap.boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-after[key])<0.5,'Focus must not move or resize the field');
   const focus=await search.evaluate(input=>{const own=getComputedStyle(input),parent=getComputedStyle(input.parentElement);return{inputShadow:own.boxShadow,inputOutline:own.outlineStyle,wrapperOutline:parent.outlineStyle,wrapperWidth:parseFloat(parent.outlineWidth),wrapperOffset:parseFloat(parent.outlineOffset)};});
   assert.equal(focus.inputShadow,'none');assert.equal(focus.inputOutline,'none');assert.equal(focus.wrapperOutline,'solid');assert(focus.wrapperWidth>=2&&focus.wrapperOffset<=0,'One contained focus indicator should remain visible');
   await audit(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const panel=await sidebar.boundingBox();await page.screenshot({path:path.join(output,`chat-sidebar-top-${width}-${theme}.png`),clip:{x:Math.max(0,panel.x),y:Math.max(0,panel.y),width:panel.width,height:Math.min(280,panel.height)}});
   await search.fill('没有匹配的测试关键词');await sidebar.getByText('没有匹配的对话',{exact:true}).waitFor();await sidebar.getByRole('button',{name:'清空搜索对话',exact:true}).click();assert.equal(await search.inputValue(),'');await focused(search);
   await search.fill('另一项测试');await search.press('Escape');assert.equal(await search.inputValue(),'');if(width===390)assert(await page.getByRole('dialog',{name:'工作台导航',exact:true}).isVisible());assert.equal(state.chatCalls,0);await audit(page);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])for(const theme of ['light','dark'])await check(`resource-history-resumes-without-empty-time-range-${width}-${theme}`,async()=>{
  const {context,page,state}=await open('resources',{width,theme});try{
   let mode='resumed';const point=(seconds,cpu)=>({timestamp:new Date(Date.UTC(2026,9,29,0,0,seconds)).toISOString(),cpu,ram_available:8*1024**3,temperature:40});
   await context.route('**/api/resources',route=>state.handle({request:()=>route.request(),fulfill:options=>{
    const data=JSON.parse(options.body),count=mode==='single'?1:mode==='continuous'?60:6;
    data.history=[...(mode==='continuous'?[]:Array.from({length:60-count},(_,i)=>point(i,95))),...Array.from({length:count},(_,i)=>point(900+i,(i%7)/10))];data.sample.timestamp=data.history.at(-1).timestamp;
    return route.fulfill({...options,body:JSON.stringify(data)});
   }}));
   await page.reload();const cpu=page.getByRole('region',{name:'CPU 使用趋势',exact:true}),ram=page.getByRole('region',{name:'可用内存趋势',exact:true}),micro=page.getByRole('group',{name:'CPU · 整机占用',exact:true});
   await cpu.getByText('6 个采样',{exact:true}).waitFor();await ram.getByText('6 个采样',{exact:true}).waitFor();await micro.getByRole('img',{name:'CPU 占用趋势，最近 6 个真实采样',exact:true}).waitFor();
   assert.equal(await cpu.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').last().textContent(),'1','An old 95% peak must not affect the resumed segment');
   const labels=await cpu.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value').allTextContents();assert(labels.length>=2);assert(labels.every(label=>/^08:15:/.test(label)),JSON.stringify(labels));
   const plot=await cpu.locator('.resource-history-chart').boundingBox();assert(await cpu.locator('.recharts-area-curve').evaluate(e=>e.getBBox().width)>plot.width*0.7,'The current segment should use the available chart width');assert(await micro.locator('.recharts-area-curve').evaluate(e=>e.getBBox().width)>70);
   await cpu.getByText(/采样时间曾中断/).waitFor();await audit(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.resource-history-grid').screenshot({path:path.join(output,`resource-history-resumed-${width}-${theme}.png`)});
   const pending=page.waitForEvent('download');await resourceAction(page,'保存快照');const download=await pending,receipt=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(receipt.history.length,60);assert.equal(receipt.history[0].cpu,95);assert.equal(receipt.history.at(-1).cpu,0.5);
   mode='single';await resourceAction(page,'刷新资源数据');await cpu.getByText('1 个采样',{exact:true}).waitFor();await cpu.getByText('等待连续的真实采样',{exact:true}).waitFor();assert.equal(await cpu.locator('.recharts-area-curve').count(),0);assert.equal(await micro.getByRole('img').count(),0);
   mode='continuous';await resourceAction(page,'刷新资源数据');await cpu.getByText('60 个采样',{exact:true}).waitFor();await cpu.locator('.recharts-area-curve').waitFor();assert.equal(await cpu.locator('.resource-history-note').count(),0);await micro.getByRole('img',{name:'CPU 占用趋势，最近 20 个真实采样',exact:true}).waitFor();await audit(page);assert.equal(state.chatCalls,0);
  }finally{await context.close();}
 });
 if(!live)for(const width of [1440,390])await check(`document-attachments-admission-and-draft-${width}`,async()=>{
  const {context,page,state}=await open('chat',{width});try{
   const picker=page.getByLabel('选择文档文件',{exact:true}),input=page.getByLabel('输入问题',{exact:true});
   await picker.setInputFiles({name:'sample.doc',mimeType:'application/msword',buffer:Buffer.from('fixture')});
   await page.getByText('文档仅支持 PDF 和 DOCX；旧版 DOC 请另存为 DOCX。',{exact:true}).waitFor();
   assert.equal(state.chatCalls,0);
   await picker.setInputFiles({name:'sample.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('fixture')});
   await page.getByRole('button',{name:'移除文档 sample.docx',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});return dispatchEvent(event);}),false);
   await input.fill('总结附件的文字内容');await page.getByRole('button',{name:'发送消息',exact:true}).click();
   await page.getByText('界面回归回答',{exact:true}).waitFor();assert.equal(state.chatCalls,1);assert.deepEqual(state.lastChat.documents,['d'.repeat(32)]);
   assert.equal(await page.getByRole('button',{name:'移除文档 sample.docx',exact:true}).count(),0);
   await page.getByText('sample.docx · 42 字符 · 仅提取文字',{exact:true}).waitFor();
   await picker.setInputFiles({name:'empty.pdf',mimeType:'application/pdf',buffer:Buffer.from('fixture')});
   await input.fill('保留这段草稿');await page.getByRole('button',{name:'发送消息',exact:true}).click();
   await page.getByText('未提取到文字，请使用可复制文字的 PDF 或 DOCX；当前不识别扫描件。',{exact:true}).waitFor();
   assert.equal(await input.inputValue(),'保留这段草稿');assert.equal(state.chatCalls,1);
   await page.getByRole('button',{name:'移除文档 empty.pdf',exact:true}).click();await input.fill('');
   await audit(page);await page.screenshot({path:path.join(output,`document-admission-${width}.png`)});
   let releaseUpload;const held=new Promise(resolve=>{releaseUpload=resolve;});
   await context.route('**/api/documents?**',async route=>{await held;return state.handle(route);});
   await picker.setInputFiles({name:'delayed.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('fixture')});
   await input.fill('原会话问题');await page.getByRole('button',{name:'发送消息',exact:true}).click();
   await page.getByRole('button',{name:'停止回答',exact:true}).waitFor();await page.keyboard.press('Control+Shift+o');await input.fill('另一会话需要保留的草稿');
   releaseUpload();await page.waitForFunction(()=>document.querySelector('#send')!==null);
   assert.equal(await input.inputValue(),'另一会话需要保留的草稿');assert.equal(state.chatCalls,2);await input.fill('');
  }finally{await context.close();}
 });
  if(!live)await check('new-chat-never-reuses-unloaded-server-history',async()=>{
   const old='e'.repeat(32),legacy=[{id:old,title:'新对话',messages:[]}];
   const {context,page,state}=await open('chat',{legacy});try{
    await page.getByRole('button',{name:'新建对话',exact:true}).click();
    const fresh=new URL(page.url()).searchParams.get('conversation');assert.notEqual(fresh,old);
    await page.getByRole('button',{name:'新建对话',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('conversation'),fresh);
    await page.getByLabel('输入问题',{exact:true}).fill('新的独立问题');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('界面回归回答',{exact:true}).waitFor();
    assert.equal(state.lastChat.conversation_id,fresh);assert.deepEqual(state.lastChat.messages,[{role:'user',content:'新的独立问题'}]);
   }finally{await context.close();}
  });
  if(!live)for(const width of [1440,390])for(const theme of ['light','dark'])await check(`blocked-document-followup-recovery-${width}-${theme}`,async()=>{
   const {context,page,state}=await open('chat',{width,theme});try{
    const payloads=[];let blocks=2;
    await context.route('**/api/chat',route=>{
     payloads.push(route.request().postDataJSON());
     if(blocks-->0)return route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({event:'error',code:'input_blocked',review_source:'document',reason_code:'document_sensitive',request_id:'blocked-fixture',error:'fixture'})+'\n{trailing-invalid-frame}\n'});
     return state.handle(route);
    });
    const picker=page.getByLabel('选择文档文件',{exact:true}),input=page.getByLabel('输入问题',{exact:true});
    const names=['第一次上传的合成审核材料.docx','第二次上传的合成审核材料_用于验证较长中文文件名在移动端自动换行.pdf'];
    for(const [i,name] of names.entries()){
     await picker.setInputFiles({name,mimeType:i?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('fixture')});
     await input.fill('被拦截的合成问题'+i);await page.getByRole('button',{name:'发送消息',exact:true}).click();
     await page.locator('.excluded-input .message-documents').getByText(name,{exact:true}).waitFor();
     // Read both positions in one frame while the conversation may be scrolling.
     assert(await page.locator('.message.user').last().evaluate(row=>{const file=row.querySelector('.message-documents').getBoundingClientRect(),notice=row.querySelector('.excluded-input-notice').getBoundingClientRect();return file.bottom<=notice.top+1;}));
     await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();
    }
    assert.equal(await page.locator('.result-card.blocked').count(),2);assert.equal(await page.locator('.result-card.failed').count(),0);
    await input.fill('计算2+2');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('界面回归回答',{exact:true}).waitFor();
    assert.deepEqual(payloads[2].messages,[{role:'user',content:'计算2+2'}]);assert.deepEqual(payloads[2].documents,[]);
    const saved=await page.evaluate(()=>localStorage.getItem('orion-workspace-sessions-v1'));for(const name of names)assert(saved.includes(name));assert(!saved.includes('被拦截的合成问题'));
    await page.reload();await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();
    for(const name of names)await page.locator('.excluded-input .message-documents').getByText(name,{exact:true}).waitFor();
    await input.fill('再计算3+3');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.message.assistant .markdown').length===2);
    assert(!JSON.stringify(payloads.at(-1)).includes('被拦截的合成问题'));assert.deepEqual(payloads.at(-1).documents,[]);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await audit(page);await page.screenshot({path:path.join(output,`blocked-document-recovery-${width}-${theme}.png`),fullPage:true});
   }finally{await context.close();}
  });
  if(!live)await check('chat-failure-types-and-next-request-recovery',async()=>{
   const {context,page,state}=await open('chat');try{
    const cases=[{status:429,body:{code:'device_busy',error:'busy'},title:'设备正在处理请求',code:'device_busy'},{status:503,body:{error:{code:'model_unavailable',message:'warming up',request_id:'model-fixture'}},title:'所选模型暂不可用',code:'model_unavailable'},{status:503,body:{code:'agent_unavailable'},title:'服务暂不可用',code:'agent_unavailable'},{status:200,raw:'{broken}\n',title:'回答服务响应异常',code:'stream_protocol_error'},{status:200,raw:'{"event":"accepted","request_id":"stream-fixture"}\n',title:'回答传输中断',code:'stream_interrupted'}];
    let fault=null;const payloads=[];await context.route('**/api/chat',route=>{payloads.push(route.request().postDataJSON());if(!fault)return state.handle(route);return route.fulfill({status:fault.status,contentType:fault.raw?'application/x-ndjson':'application/json',body:fault.raw||JSON.stringify(fault.body)});});
    const input=page.getByLabel('输入问题',{exact:true});
    for(const [i,item] of cases.entries()){
     fault=item;await input.fill('失败请求夹具'+i);await page.getByRole('button',{name:'发送消息',exact:true}).click();
     await page.locator('.result-card.failed').last().getByText(item.title,{exact:true}).waitFor();await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();
     assert.match(await page.locator('.message.user').last().innerText(),/本轮未完成/);assert(!await page.locator('.result-card.failed').last().innerText().then(text=>text.includes('网络连接失败')));
     const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('orion-workspace-sessions-v1')));const error=saved[0].messages.at(-1).meta.error;assert.equal(error.code,item.code);if(item.status!==200)assert.equal(error.http_status,item.status);
     fault=null;await input.fill('恢复后的计算'+i);await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.message.assistant .markdown').length===n,i+1);
     assert(!JSON.stringify(payloads.at(-1)).includes('失败请求夹具'));
    }
    await audit(page);await page.screenshot({path:path.join(output,'chat-failure-types.png'),fullPage:true});
   }finally{await context.close();}
  });
  await check('uncaught-page-errors',async()=>assert.deepEqual(report.runtimeErrors,[]));
} catch(error) {report.runnerError=error.message;}
finally {if(browser) await browser.close();if(server) await new Promise(resolve=>server.close(resolve));clearTimeout(deadline);report.finishedAt=new Date().toISOString();report.passed=!report.runnerError&&report.checks.length>0&&report.checks.every(c=>c.status==='passed');save();}
console.log(JSON.stringify({passed:report.passed,total:report.checks.length,failed:report.checks.filter(c=>c.status!=='passed').length,runnerError:report.runnerError}));
if(!report.passed) process.exitCode=1;
