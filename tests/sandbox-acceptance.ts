// Run on Linux in a bounded user unit; this fixture never loads model credentials.
import { Workspace, sandbox } from '../packages/tool-runner/src/index.ts';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'orion-sandbox-acceptance-'));
const project=path.join(root,'project');await fs.mkdir(project);
const results:Record<string,boolean>={};
process.env.ORION_SECRET_FIXTURE='parent_environment_fixture';
try {
  await fs.writeFile(path.join(project,'.env'),'PRIVATE_FIXTURE_ONLY');
  await fs.writeFile(path.join(project,'test_isolation.py'),`import os,pathlib,socket,unittest
class Isolation(unittest.TestCase):
 def test_home_hidden(self): self.assertFalse(pathlib.Path('/home').exists())
 def test_environment_empty(self): self.assertIsNone(os.getenv('ORION_SECRET_FIXTURE'))
 def test_hidden_file_excluded(self): self.assertFalse(pathlib.Path('/workspace/.env').exists())
 def test_network_isolated(self):
  with self.assertRaises(OSError): socket.create_connection(('127.0.0.1',17790),timeout=.3)
 def test_copy_write(self): pathlib.Path('/workspace/generated.txt').write_text('copy only')
`);
  const workspace=new Workspace(project,path.join(root,'scratch'));
  const output=await workspace.check('python_tests',new AbortController().signal);
  assert.ok(output.startsWith('exit_code=0')&&output.includes('Ran 5 tests')&&output.includes('OK'),output);
  await assert.rejects(fs.stat(path.join(project,'generated.txt')));
  results.isolation_and_copy=true;
  const scratch=path.join(root,'direct');await fs.mkdir(scratch);
  const marker='orion_sandbox_marker_'+Date.now();
  const controller=new AbortController();
  const pending=sandbox(scratch,['/usr/bin/python3','-I','-c',`import subprocess,time;subprocess.Popen(['/usr/bin/python3','-I','-c','import time;time.sleep(60)','${marker}'],start_new_session=True);time.sleep(60)`,marker],controller.signal);
  setTimeout(()=>controller.abort(),600);await assert.rejects(pending,/cancelled/);
  await new Promise(resolve=>setTimeout(resolve,200));
  const leaked=[];
  for(const entry of await fs.readdir('/proc'))if(/^\d+$/.test(entry)){try{if((await fs.readFile('/proc/'+entry+'/cmdline','utf8')).includes(marker))leaked.push(entry);}catch{}}
  assert.equal(leaked.length,0,'Cancellation left descendant processes');results.cancel_descendants=true;
  await assert.rejects(sandbox(scratch,['/usr/bin/python3','-I','-c',"print('x'*100000)"],new AbortController().signal),/output_limit/);results.output_limit=true;
  const started=Date.now();await assert.rejects(sandbox(scratch,['/usr/bin/python3','-I','-c','import time;time.sleep(60)'],new AbortController().signal),/tool_timeout/);
  assert.ok(Date.now()-started<35000);results.timeout=true;
  console.log(JSON.stringify({passed:true,checks:results}));
}finally{await fs.rm(root,{recursive:true,force:true});}
