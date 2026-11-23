import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const protectedPart = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.codex|\.pi|node_modules|\.runtime|credentials?(?:\..*)?|secrets?(?:\..*)?|settings\.json|auth\.json|.*\.(?:pem|key|p12|pfx))$/i;
export function relativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\0\\:]/.test(value) || path.posix.isAbsolute(value)) throw new Error('path_denied');
  const parts = value.split('/');
  if (parts.some(p => !p || p.startsWith('.') || protectedPart.test(p))) throw new Error('path_denied');
  return value;
}
export function safeText(value: string): string {
  if (/(?:sk-[a-zA-Z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|authorization)\s*[:=]\s*[^\s]{6,})/i.test(value)) throw new Error('sensitive_tool_content');
  return value;
}
export class Workspace {
  readonly root: string; readonly scratchRoot: string;
  guardMutation?: (kind: 'file'|'directory', file: string, content?: string) => Promise<void>;
  constructor(root: string, scratchRoot: string) { this.root = root; this.scratchRoot = scratchRoot; }
  async resolve(value: unknown, missing = false): Promise<string> {
    const rel = relativePath(value); const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('linked_path_denied');
    const root = await fs.realpath(this.root);
    let current = root;
    for (const [i, part] of rel.split('/').entries()) {
      current = path.join(current, part);
      try { const stat = await fs.lstat(current); if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw new Error('linked_path_denied'); }
      catch (e: any) { if (!(missing && e.code === 'ENOENT' && i === rel.split('/').length - 1)) throw e; }
    }
    return current;
  }
  async read(value: unknown): Promise<string> {
    const target = await this.resolve(value), file = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32768) throw new Error('file_limit'); return safeText(await file.readFile('utf8')); } finally { await file.close(); }
  }
  async list(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string, prefix = '', depth = 0) => {
      if (depth > 5 || files.length >= 200) return;
      for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || protectedPart.test(entry.name) || entry.isSymbolicLink()) continue;
        const rel = prefix + entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/', depth + 1);
        else if (entry.isFile() && files.length < 200) { const stat = await fs.lstat(path.join(dir, entry.name)); if (stat.nlink === 1) files.push(rel); }
      }
    };
    await walk(await fs.realpath(this.root)); return files;
  }
  async proposal(file: unknown, content: unknown) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 32768) throw new Error('file_limit');
    safeText(content); const target = await this.resolve(file, true);
    let before = ''; let exists = true;
    try { before = await this.read(file); } catch (e: any) { if (e.code !== 'ENOENT') throw e; exists = false; }
    return { file: String(file), content, before, beforeHash: exists ? digest(before) : null, target };
  }
  async directoryProposal(value: unknown) {
    const target = await this.resolve(value, true);
    try { await fs.lstat(target); throw new Error('path_exists'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    return { file: String(value), target };
  }
  async createDirectory(proposal: Awaited<ReturnType<Workspace['directoryProposal']>>) {
    const current = await this.directoryProposal(proposal.file);
    if (current.target !== proposal.target) throw new Error('stale_approval');
    await this.guardMutation?.('directory', proposal.file);
    await fs.mkdir(current.target, { mode: 0o700 }); return { directory: proposal.file };
  }
  async apply(proposal: Awaited<ReturnType<Workspace['proposal']>>) {
    const current = await this.proposal(proposal.file, proposal.content);
    if (current.beforeHash !== proposal.beforeHash || current.target !== proposal.target) throw new Error('stale_approval');
    await this.guardMutation?.('file', proposal.file, proposal.content);
    const temp = path.join(path.dirname(proposal.target), '.orion-' + randomUUID());
    try { await fs.writeFile(temp, proposal.content, { mode: 0o600, flag: 'wx' }); await fs.rename(temp, proposal.target); } finally { await fs.rm(temp, { force: true }); }
    return { file: proposal.file, sha256: digest(proposal.content), bytes: Buffer.byteLength(proposal.content) };
  }
  async check(kind: string, signal: AbortSignal): Promise<string> {
    if (process.platform !== 'linux' || !['python_compile', 'python_tests'].includes(kind)) throw new Error('sandbox_unavailable');
    const group = (await fs.readFile('/proc/self/cgroup','utf8')).match(/^0::(\/[^\n]*)$/m)?.[1];
    if (!group || group.includes('..')) throw new Error('process_budget_unavailable');
    const pidsLimit = Number((await fs.readFile(path.join('/sys/fs/cgroup',group,'pids.max'),'utf8')).trim());
    if (!Number.isInteger(pidsLimit) || pidsLimit < 1 || pidsLimit > 128) throw new Error('process_budget_unavailable');
    await fs.mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = await fs.mkdtemp(path.join(this.scratchRoot, 'check-')); let total = 0;
    try {
      for (const file of await this.list()) {
        if (!/\.(?:py|txt|md|json|toml)$/.test(file)) continue;
        const content = await this.read(file); total += Buffer.byteLength(content); if (total > 1024 * 1024) throw new Error('snapshot_limit');
        const dest = path.join(scratch, file); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, content, { mode: 0o600 });
      }
      const command = kind === 'python_compile' ? ['/usr/bin/python3', '-I', '-m', 'compileall', '-q', '/workspace'] : ['/usr/bin/python3', '-I', '-m', 'unittest', 'discover', '-s', '/workspace', '-v'];
      return await sandbox(scratch, command, signal);
    } finally {
      const base = await fs.realpath(this.scratchRoot), target = await fs.realpath(scratch);
      if (path.dirname(target) !== base || !path.basename(target).startsWith('check-')) throw new Error('cleanup_scope');
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}
export function sandbox(scratch: string, command: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const args = ['--as=536870912', '--cpu=20', '--fsize=5242880', '--nofile=64', '--', '/usr/bin/bwrap', '--unshare-all', '--new-session', '--die-with-parent', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', scratch, '/workspace', '--chdir', '/workspace', '--clearenv', '--setenv', 'PATH', '/usr/bin', '--setenv', 'HOME', '/tmp', '--', ...command];
    const child = spawn('/usr/bin/prlimit', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin' } });
    let output = '', bytes = 0, failure = '';
    const kill = (why: string) => { failure ||= why; try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const abort = () => kill('cancelled'); signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => kill('tool_timeout'), 30000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) kill('output_limit'); else output += chunk.toString('utf8'); });
    child.on('error', () => kill('sandbox_unavailable'));
    child.on('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (failure) reject(new Error(failure)); else { try { resolve(safeText(`exit_code=${code}\n${output}`)); } catch (e) { reject(e); } } });
  });
}
