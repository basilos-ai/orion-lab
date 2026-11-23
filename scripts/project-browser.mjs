/** Project UI acceptance against the real Node API; --live uses the deployed gateway. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import axe from 'axe-core';

const root=path.resolve(import.meta.dirname,'..'),live=process.argv.includes('--live');
const output=path.resolve(root,process.env.ORION_PROJECT_OUTPUT||'.harness/runs/project-spaces/browser');fs.mkdirSync(output,{recursive:true});
const report={mode:live?'device':'real-node-api',started:new Date().toISOString(),checks:[],errors:[]};
let server,child,browser,state;const auth='project-browser-fixture-'.repeat(3),owner='a'.repeat(64);let modelCalls=0;
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
async function check(id,fn){const start=Date.now();try{await fn();report.checks.push({id,status:'passed',elapsed:Date.now()-start});}catch(e){report.checks.push({id,status:'failed',error:e.message});}console.log(report.checks.at(-1).status+' '+id);save();}
async function audit(page){const result=await page.evaluate(async source=>{(0,eval)(source);return window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});},axe.source);assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal document overflow');}
try{
  let base=process.env.ORION_PROJECT_URL;
  if(!live){
    const buildDirectory=path.join(output,'build');
    const build=spawnSync(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--config',path.join(root,'apps/console/vite.config.ts')],{cwd:path.join(root,'apps/console'),env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('O6N_'))),O6N_DATA_DIR:path.join(root,'examples'),O6N_BUILD_DIR:buildDirectory},encoding:'utf8'});
    assert.equal(build.status,0,build.stderr||build.stdout);
    state=fs.mkdtempSync(path.join(os.tmpdir(),'orion-project-browser-'));fs.writeFileSync(path.join(state,'internal-token'),auth);
    child=spawn(process.execPath,['--experimental-strip-types','apps/agent-server/src/index.ts'],{cwd:root,env:{...process.env,ORION_AGENT_STATE:state,ORION_AGENT_PORT:'0'},stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{let text='',error='';const timer=setTimeout(()=>reject(new Error('Node startup timeout')),10000);child.stderr.on('data',d=>error+=d);child.stdout.on('data',d=>{text+=d;const m=text.match(/loopback (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Node startup '+code+' '+error));});});
    server=createServer(async(req,res)=>{
      try{
        const route=new URL(req.url,'http://localhost').pathname;
        if(route.startsWith('/api/agent/')){let body='';for await(const part of req)body+=part;const response=await fetch('http://127.0.0.1:'+port+route.slice('/api/agent'.length),{method:req.method,headers:{Authorization:'Bearer '+auth,'X-Orion-Owner':owner,'Content-Type':'application/json'},body:body||undefined});res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/json'});res.end(Buffer.from(await response.arrayBuffer()));return;}
        if(route==='/api/session'){res.setHeader('Content-Type','application/json');res.end('{"authorized":true}');return;}
        if(route==='/api/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({guard_ready:true,busy:false,models:Object.fromEntries(['small','standard','large','cloud'].map(id=>[id,{label:id,ready:true}])),switch:{status:'ready'}}));return;}
        if(route==='/api/chat'){modelCalls++;res.writeHead(500);res.end('{}');return;}
        const directory=buildDirectory,file=path.resolve(directory,'.'+(route==='/'?'/chat.html':route));
        if(!file.startsWith(directory+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
      }catch{res.writeHead(500);res.end('{}');}
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/';
  }
  assert(base,'ORION_PROJECT_URL required for --live');browser=await chromium.launch({headless:true,...(process.env.ORION_BROWSER_CHANNEL?{channel:process.env.ORION_BROWSER_CHANNEL}:{})});
  const suffix=randomUUID().slice(0,8);report.label='项目验收-'+suffix;
  const fixtureDir=path.join(output,'upload-source');fs.mkdirSync(path.join(fixtureDir,'src'),{recursive:true});fs.writeFileSync(path.join(fixtureDir,'src','hello.py'),'print("project import")\n');fs.writeFileSync(path.join(fixtureDir,'README.md'),'existing path must survive');fs.writeFileSync(path.join(fixtureDir,'.env'),'excluded fixture');
  let context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN',reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));context.on('request',req=>{if(req.method()==='POST'&&['/api/chat','/api/agent/runs'].includes(new URL(req.url()).pathname))modelCalls++;});
  await page.goto(base+'?conversation='+randomUUID().replaceAll('-','')+'#chat');await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();
  let project;
  await check('create-project-no-model-request-default-local',async()=>{
    await page.getByRole('button',{name:'创建项目',exact:true}).click();const dialog=page.getByRole('dialog',{name:'创建项目空间',exact:true});await dialog.waitFor();await dialog.getByLabel('项目名称',{exact:false}).fill(report.label);await dialog.getByLabel('项目说明',{exact:false}).fill('项目空间功能验收；文件均为测试样例。');await audit(page);await page.screenshot({path:path.join(output,'create-desktop-light.png'),fullPage:true});await dialog.getByRole('button',{name:'创建并进入',exact:true}).click();await dialog.waitFor({state:'hidden'});
    project=(await(await context.request.get(new URL('/api/agent/projects',base).href)).json()).projects.find(p=>p.name===report.label);assert(project);report.project=project.id;
    await page.getByRole('button',{name:/^选择回答模型，当前 Auto/}).click();assert(await page.getByRole('radio',{name:/仅本地/}).isChecked());await page.keyboard.press('Escape');assert.equal(modelCalls,0);
    assert.equal(await page.locator('.agent-mode-label').count(),0);
  });
  if(project){
    await page.getByRole('button',{name:'选择或管理项目',exact:true}).click();const manager=page.getByRole('dialog',{name:'项目空间',exact:true});
    await check('create-edit-read-download-file-and-directory',async()=>{
      await manager.getByRole('button',{name:'新建目录',exact:true}).click();await manager.getByLabel('新目录路径',{exact:true}).fill('notes');await manager.getByRole('button',{name:'创建目录',exact:true}).click();await manager.getByText('notes/',{exact:true}).waitFor();
      await manager.getByRole('button',{name:'新建文件',exact:true}).click();await manager.getByLabel('新文件路径',{exact:true}).fill('README.md');await manager.getByLabel('文件内容',{exact:true}).fill('保留原始文件');await manager.getByRole('button',{name:'保存文件',exact:true}).click();await manager.getByRole('button',{name:/^README.md/}).click();assert.equal(await manager.getByLabel('文件内容',{exact:true}).inputValue(),'保留原始文件');
      const download=page.waitForEvent('download');await manager.getByRole('button',{name:'下载文件',exact:true}).click();await(await download).saveAs(path.join(output,'README.download.txt'));assert.equal(fs.readFileSync(path.join(output,'README.download.txt'),'utf8'),'保留原始文件');
      await manager.getByRole('button',{name:'返回文件列表',exact:true}).click();
    });
    await check('folder-preview-skips-hidden-and-existing-files',async()=>{
      await manager.locator('input[webkitdirectory]').setInputFiles(fixtureDir);await manager.getByRole('button',{name:'确认导入 1 个文件',exact:true}).waitFor();await manager.getByText(/已跳过 2 项/).click();await manager.getByText(/路径已存在，不覆盖/).waitFor();await audit(page);await page.screenshot({path:path.join(output,'import-desktop-light.png'),fullPage:true});await manager.getByRole('button',{name:'确认导入 1 个文件',exact:true}).click();await manager.getByRole('button',{name:/^src\/hello.py/}).waitFor();
      const data=await(await context.request.get(new URL('/api/agent/projects/'+project.id+'/export',base).href)).json();assert.equal(data.files.find(f=>f.path==='README.md').content,'保留原始文件');assert(data.files.some(f=>f.path==='src/hello.py'));assert(!data.files.some(f=>f.path.startsWith('.')));
    });
    await check('failed-save-retains-draft-and-retry-succeeds',async()=>{
      await manager.getByRole('button',{name:/^README.md/}).click();await manager.getByLabel('文件内容',{exact:true}).fill('新的人工修改');let fail=true;await context.route('**/api/agent/projects/*/write',route=>{if(fail){fail=false;return route.fulfill({status:409,contentType:'application/json',body:'{"code":"stale_approval"}'});}return route.continue();});
      await manager.getByRole('button',{name:'保存文件',exact:true}).click();await manager.getByRole('alert').waitFor();assert.equal(await manager.getByLabel('文件内容',{exact:true}).inputValue(),'新的人工修改');await manager.getByRole('button',{name:'保存文件',exact:true}).click();await manager.getByRole('button',{name:/^README.md/}).waitFor();await context.unroute('**/api/agent/projects/*/write');
    });
    await check('zip-export-and-archive-restore-preserve-files',async()=>{
      const download=page.waitForEvent('download');await manager.getByRole('button',{name:'导出 ZIP',exact:true}).click();await(await download).saveAs(path.join(output,'project.zip'));
      await manager.getByRole('button',{name:'归档项目',exact:true}).click();await page.getByRole('dialog',{name:'归档项目',exact:true}).getByRole('button',{name:'确认归档',exact:true}).click();await manager.getByRole('button',{name:'恢复项目',exact:true}).waitFor();assert(await manager.getByRole('button',{name:'新建文件',exact:true}).isDisabled());
      await manager.getByRole('button',{name:'恢复项目',exact:true}).click();await page.getByRole('dialog',{name:'恢复项目',exact:true}).getByRole('button',{name:'确认恢复',exact:true}).click();await manager.getByRole('button',{name:'归档项目',exact:true}).waitFor();assert(await manager.getByRole('button',{name:'新建文件',exact:true}).isEnabled());
    });
    await check('project-info-edit-and-conversation-grouping',async()=>{
      await manager.getByRole('button',{name:'编辑信息',exact:true}).click();await manager.getByLabel('项目名称',{exact:true}).fill(report.label+'-已编辑');await manager.getByRole('button',{name:'保存信息',exact:true}).click();await manager.getByRole('heading',{name:report.label+'-已编辑',exact:true}).waitFor();await manager.getByRole('button',{name:'进入项目',exact:true}).click();
      assert.equal(await page.locator('#sessions .project-group-title').filter({hasText:report.label+'-已编辑'}).count(),1);await page.getByRole('button',{name:`在 ${report.label}-已编辑 新建对话`,exact:true}).click();await page.reload();await page.getByRole('status',{name:'设备已连接',exact:true}).waitFor();await page.getByRole('button',{name:'选择或管理项目',exact:true}).click();await manager.getByRole('heading',{name:report.label+'-已编辑',exact:true}).waitFor();await manager.getByRole('button',{name:/^README.md/}).waitFor();
    });
    await manager.getByRole('button',{name:'关闭',exact:true}).click();
    for(const width of [1440,390])for(const theme of ['light','dark'])await check(`project-manager-keyboard-a11y-${width}-${theme}`,async()=>{
      await page.setViewportSize({width,height:width===390?844:900});await page.evaluate(t=>dispatchEvent(new CustomEvent('orion-theme',{detail:t})),theme);await page.getByRole('button',{name:'选择或管理项目',exact:true}).click();await manager.waitFor();await audit(page);const box=await manager.boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=(width===390?844:900)+1,JSON.stringify(box));await page.screenshot({path:path.join(output,`manager-${width}-${theme}.png`),fullPage:true});await page.keyboard.press('Escape');await manager.waitFor({state:'hidden'});await page.waitForFunction(e=>e===document.activeElement,await page.getByRole('button',{name:'选择或管理项目',exact:true}).elementHandle());
    });
    await check('create-from-folder-confirms-before-writing-on-mobile',async()=>{
      await page.getByRole('button',{name:'选择或管理项目',exact:true}).click();await manager.getByRole('button',{name:'新建项目',exact:true}).click();const dialog=page.getByRole('dialog',{name:'创建项目空间',exact:true});await dialog.waitFor();await dialog.getByLabel('项目名称',{exact:false}).fill(report.label+'-文件夹');await dialog.getByRole('radio',{name:/导入电脑文件夹/}).check();await dialog.locator('input[webkitdirectory]').setInputFiles(fixtureDir);await dialog.getByText('2 个可导入文件',{exact:false}).waitFor();await dialog.getByRole('button',{name:'创建并进入',exact:true}).click();const confirm=dialog.getByRole('button',{name:'确认导入 2 个文件',exact:true});await confirm.waitFor();
      const box=await confirm.boundingBox();assert(box.y>=0&&box.y+box.height<=844,'Import confirmation must remain visible in the footer');
      const value=(await(await context.request.get(new URL('/api/agent/projects',base).href)).json()).projects.find(p=>p.name===report.label+'-文件夹');assert(value);assert.equal((await(await context.request.get(new URL('/api/agent/projects/'+value.id+'/files',base).href)).json()).files.length,0);
      await audit(page);await page.screenshot({path:path.join(output,'create-folder-preview-mobile.png'),fullPage:true});await confirm.click();await dialog.waitFor({state:'hidden'});assert.equal((await(await context.request.get(new URL('/api/agent/projects/'+value.id+'/files',base).href)).json()).files.length,2);
      if(live){const p=(await(await context.request.get(new URL('/api/agent/projects/'+value.id,base).href)).json());await context.request.post(new URL('/api/agent/projects/'+value.id+'/update',base).href,{data:{action:'archive',revision:p.revision}});}
    });
    // Leave only an archived, clearly labelled test project on a real device.
    if(live){const current=(await(await context.request.get(new URL('/api/agent/projects/'+project.id,base).href)).json());await context.request.post(new URL('/api/agent/projects/'+project.id+'/update',base).href,{data:{action:'archive',revision:current.revision}});}
  }
  await context.close();
  for(const width of [1440,390])for(const theme of ['light','dark'])await check(`create-form-keyboard-a11y-${width}-${theme}`,async()=>{
    context=await browser.newContext({viewport:{width,height:width===390?844:900},locale:'zh-CN',reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(base+'?conversation='+randomUUID().replaceAll('-','')+'&theme='+theme+'#chat');await page.getByRole('button',{name:'创建项目',exact:true}).click();const dialog=page.getByRole('dialog',{name:'创建项目空间',exact:true});await dialog.waitFor();await dialog.getByLabel('项目名称',{exact:false}).focus();await page.keyboard.type('Keyboard');await page.keyboard.press('Tab');assert.equal(await dialog.getByLabel('项目说明',{exact:false}).evaluate(e=>e===document.activeElement),true);await audit(page);await page.screenshot({path:path.join(output,`create-${width}-${theme}.png`),fullPage:true});await page.keyboard.press('Escape');const discard=page.getByRole('dialog',{name:'关闭当前编辑？',exact:true});await discard.waitFor();await discard.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await dialog.getByLabel('项目名称',{exact:false}).inputValue(),'Keyboard');await context.close();
  });
  report.modelRequests=modelCalls;assert.equal(modelCalls,0);await check('no-uncaught-page-errors',async()=>assert.deepEqual(report.errors,[]));
}finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}if(state){assert(path.dirname(state)===os.tmpdir());fs.rmSync(state,{recursive:true,force:true});}
  report.passed=report.checks.length>0&&report.checks.every(c=>c.status==='passed');report.finished=new Date().toISOString();save();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length}));if(!report.passed)process.exitCode=1;
}
