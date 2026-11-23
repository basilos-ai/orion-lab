import test from 'node:test';
import assert from 'node:assert/strict';
import {readGatewayEvidence,turnEvidence} from '../apps/console/src/lib/request-evidence.ts';

test('an imported request preserves published quota bindings, not unrelated request bodies or secrets',()=>{
  const report={schema:'orion-request-v1',request:{workspace_id:'w',request_id:'r',release_id:'v',requested_model:'@int/model',upstream_model:'model',body:'original text'},
    release:{id:'v',limit_policy_count:1,limit_policies:[{id:'p',scopes:[{logical_model:'demo-chat'}],limits:{rpm:1,tpm:1},credentials:'omit'}],bindings:[{config_id:'c',model:'demo-chat',limit_policy_id:'p'}]}};
  const result=readGatewayEvidence(JSON.stringify(report));
  assert.deepEqual(result.release.bindings,report.release.bindings);
  assert.deepEqual(result.release.limit_policies[0],{id:'p',scopes:[{logical_model:'demo-chat'}],limits:{rpm:1,tpm:1}});
  assert.equal(result.request.body,undefined);
  assert.throws(()=>readGatewayEvidence(JSON.stringify({...report,release:{...report.release,id:'other'}})));
  assert.throws(()=>readGatewayEvidence(JSON.stringify({...report,release:{...report.release,limit_policy_count:0}})));
  assert.equal(turnEvidence({error:{error:'original blocked content'}}),undefined);
});
