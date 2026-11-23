import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from '../packages/contracts/src/turn-plan.ts';

const plan=(overrides={})=>planTurn({prompt:'你好',project:null,files:[],model:'auto',images:false,...overrides});
test('Unified Agent allows no-project chat and every direct-answer model',()=>{
 for(const model of ['auto','small','tiny','standard','large','cpu','vision','cloud']){
  const p=plan({model});assert.equal(p.execution,'answer');assert.equal(p.needsProject,false);assert.equal(p.access,'read');
 }
 assert.equal(plan({prompt:'解释如何读取项目文件'}).needsProject,false);
 assert.equal(plan({prompt:'读取 README.md'}).needsProject,true);
});
test('Project admission keeps read as default and approvals available only for explicit mutation requests',()=>{
 assert.equal(plan({project:'demo',prompt:'读取 README.md'}).access,'read');
 const write=plan({project:'demo',prompt:'修改 demo.py，把结果改成2'});
 assert.equal(write.execution,'tools');assert.equal(write.access,'edit');
 assert.equal(plan({project:'demo',prompt:'解释如何修改项目文件'}).access,'read');
 assert.equal(plan({project:'demo',prompt:'运行项目测试'}).access,'edit');
 assert.equal(plan({project:'demo',prompt:'修改 probe.py，内容如下：```python\nVALUE = 2\n```'}).access,'edit');
 assert.equal(plan({project:'demo',model:'small',prompt:'修改 probe.py，内容如下：```python\nVALUE = 2\n```'}).needsToolModel,true);
 assert.equal(plan({project:'demo',model:'small',prompt:'优化当前项目的实现'}).needsToolModel,true);
 assert.equal(plan({prompt:'修改下面代码：```python\nVALUE = 2\n```'}).needsProject,false);
 assert.equal(plan({project:'demo',prompt:'```python\nVALUE = 2\n```\n请写入 probe.py'}).access,'edit');
 assert.equal(plan({project:'demo',prompt:'分析以下代码：```python\nwrite_file("probe.py")\n```'}).access,'read');
});
test('Direct-only models are retained without silently switching or receiving file tools',()=>{
 for(const model of ['small','tiny','large','cpu','vision']){
  assert.equal(plan({project:'demo',model}).execution,'answer');
  const p=plan({project:'demo',model,prompt:'读取 README.md'});
  assert.equal(p.execution,'answer');assert.equal(p.needsToolModel,true);
  assert.equal(plan({project:'demo',model,files:['README.md']}).needsToolModel,true);
 }
});
test('Images use the answer path even in a project and never enter the tool path',()=>{
 for(const model of ['auto','standard','vision']){
  const p=plan({project:'demo',model,images:true,prompt:'图片中是什么颜色'});
  assert.equal(p.execution,'answer');assert.equal(p.imageTools,false);
 }
 assert.equal(plan({project:'demo',images:true,prompt:'根据图片修改项目文件'}).imageTools,true);
});
