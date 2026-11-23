import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentProgress,historyGroup,sessionTime} from '../apps/console/src/lib/chat-experience.ts';

test('Waiting feedback follows unfinished tool IDs and does not expose arbitrary arguments',()=>{
 const events=[{type:'tool_start',data:{id:'a',tool:'read_file',args:{path:'README.md',content:'private body'}}},{type:'tool_start',data:{id:'b',tool:'search_files',args:{query:'private query'}}}];
 const run={phase:'running',events};
 assert.equal(agentProgress(run),'正在搜索项目');
 events.push({type:'tool_end',data:{id:'b'}});assert.equal(agentProgress(run),'正在读取文件 · README.md');
 events.push({type:'tool_error',data:{id:'a'}});assert.equal(agentProgress(run),'正在整理回答');
 assert.equal(agentProgress({...run,phase:'checking'}),'正在检查输入');
 assert.equal(agentProgress({phase:'running',events:[]}), '正在思考');
  assert.equal(agentProgress({phase:'running',events:[{type:'format_repair',data:{state:'started'}}]}),'正在校正回答格式');
  assert.equal(agentProgress({phase:'running',events:[{type:'format_repair',data:{state:'started'}},{type:'format_repair',data:{state:'completed'}}]}),'正在思考');
});
test('History groups unknown dates separately and never invents or changes stored history',()=>{
 const now=new Date(2026,9,20,12),yesterday=new Date(2026,9,19,23),session={messages:[{runId:'r'},{meta:{stages:[{created:'invalid'}]}}]},before=JSON.stringify(session);
 assert.equal(sessionTime(session,{r:{created:yesterday.toISOString()}}),yesterday.getTime());
 assert.equal(historyGroup(yesterday.getTime(),now),'昨天');assert.equal(historyGroup(now.getTime(),now),'今天');
 assert.equal(historyGroup(new Date(2026,9,18).getTime(),now),'更早');assert.equal(historyGroup(sessionTime(session,{}),now),'其他对话');assert.equal(JSON.stringify(session),before);
});
