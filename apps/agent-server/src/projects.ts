import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Workspace, digest, relativePath, safeText } from '@orion/tool-runner';
import { projectId, projectLimits, type ProjectSummary, type ProjectEntry, type ImportPreview } from '@orion/contracts';

type Stored = ProjectSummary & { owner: string | null; revision: string; requestId?: string };
type Stage = { project: string; owner: string; fingerprint: string; preview: ImportPreview; entries: { path: string; content: string }[] };
const validateOwner = (owner: string) => { if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('owner_required'); };
const fields = (body: any) => {
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 60 || /[\x00-\x1f]/.test(body.name)) throw new Error('invalid_project_name');
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 1500)) throw new Error('project_description_limit');
  return { name: safeText(body.name.trim()), description: safeText(body.description || '') };
};
/** Private registry and managed roots. No arbitrary host paths are accepted. */
export class ProjectStore {
  private stages = new Map<string, Stage>();
  readonly root: string;
  constructor(root: string) { this.root = root; }
  private metadata(id: string) { return path.join(this.root, 'project-registry', projectId(id) + '.json'); }
  directory(id: string) { return path.join(this.root, 'projects', projectId(id)); }
  workspace(id: string, owner?: string) {
    const workspace=new Workspace(this.directory(id), path.join(this.root, 'project-scratch', projectId(id)));
    if(owner)workspace.guardMutation=async(kind,rel,content)=>{
      await this.get(id,owner,true);
      if(rel.split('/').length>(kind==='directory'?projectLimits.depth:projectLimits.depth+1))throw new Error('path_depth');
      if(kind==='directory')await this.budget(id,owner,0,0,1);
      else {const proposal=await workspace.proposal(rel,content);await this.budget(id,owner,Buffer.byteLength(proposal.content)-Buffer.byteLength(proposal.before),proposal.beforeHash===null?1:0,proposal.beforeHash===null?1:0);}
    };
    return workspace;
  }
  private async save(item: Stored) {
    const file = this.metadata(item.id), temp = file + '.' + randomUUID();
    await fs.writeFile(temp, JSON.stringify(item), { mode: 0o600, flag: 'wx' }); await fs.rename(temp, file);
  }
  async init() {
    await fs.mkdir(path.join(this.root, 'project-registry'), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.root, 'project-imports'), { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(path.join(this.root,'project-imports'))) {
      if (!/^[a-f0-9-]{36}$/.test(entry)) continue;
      const dir=path.join(this.root,'project-imports',entry);
      try {
        const meta=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
        const target=this.directory(meta.project);
        try { await fs.access(target); } catch(e:any) { if(e.code!=='ENOENT')throw e; await fs.rename(path.join(dir,'before'),target); }
      } catch(e:any) { if(e.code!=='ENOENT')throw e; }
    }
    await fs.mkdir(this.directory('demo'), { recursive: true, mode: 0o700 });
    try { await fs.access(this.metadata('demo')); } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      const stamp = new Date().toISOString();
      await this.save({ id: 'demo', name: 'O6N 沙盒项目', description: '保留原有文件和会话的示例项目。', owner: null, source: 'legacy', status: 'active', location: 'o6n', created: stamp, updated: stamp, revision: randomUUID() });
    }
  }
  async get(id: string, owner: string, writable = false): Promise<Stored> {
    validateOwner(owner);
    let item: Stored;
    try { item = JSON.parse(await fs.readFile(this.metadata(id), 'utf8')); } catch (e: any) { if (e.code === 'ENOENT') throw new Error('project_not_found'); throw e; }
    if (item.owner !== owner && !(item.id === 'demo' && item.owner === null)) throw new Error('project_denied');
    if (writable && item.status === 'archived') throw new Error('project_archived');
    return item;
  }
  public(item: Stored): ProjectSummary { const { owner, requestId, ...view } = item; return view; }
  async list(owner: string) {
    validateOwner(owner); const result: ProjectSummary[] = [];
    for (const file of await fs.readdir(path.join(this.root, 'project-registry'))) {
      if (!/^[a-z0-9_-]{1,40}\.json$/.test(file)) continue;
      const item: Stored = JSON.parse(await fs.readFile(path.join(this.root, 'project-registry', file), 'utf8'));
      if (item.owner === owner || item.id === 'demo' && item.owner === null) result.push(this.public(item));
    }
    return result.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  }
  async create(body: any, owner: string) {
    validateOwner(owner); const values = fields(body);
    const id = projectId(body.id);
    if (!/^p_[a-f0-9]{32}$/.test(id)) throw new Error('invalid_project');
    try { const existing = await this.get(id, owner); return this.public(existing); } catch (e: any) { if (e.message !== 'project_not_found') throw e; }
    if ((await this.list(owner)).length >= 100) throw new Error('project_limit');
    await fs.mkdir(this.directory(id), { mode: 0o700 });
    const stamp = new Date().toISOString();
    const item: Stored = { id, ...values, owner, source: 'empty', status: 'active', location: 'o6n', created: stamp, updated: stamp, revision: randomUUID() };
    await this.save(item); return this.public(item);
  }
  async update(id: string, owner: string, body: any) {
    const item = await this.get(id, owner);
    if (body.revision !== item.revision) throw new Error('project_changed');
    if (body.action === 'archive' || body.action === 'restore') item.status = body.action === 'archive' ? 'archived' : 'active';
    else Object.assign(item, fields(body));
    item.revision = randomUUID(); item.updated = new Date().toISOString(); await this.save(item); return this.public(item);
  }
  async tree(id: string, owner: string) {
    await this.get(id, owner); const workspace = this.workspace(id), entries: ProjectEntry[] = []; let truncated = false;
    const walk = async (directory = '', depth = 0) => {
      if (depth > projectLimits.depth) { truncated = true; return; }
      const base = directory ? await workspace.resolve(directory) : await fs.realpath(workspace.root);
      for (const entry of (await fs.readdir(base, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        const rel = directory ? directory + '/' + entry.name : entry.name;
        try { relativePath(rel); } catch { continue; }
        if (entries.length >= projectLimits.entries) { truncated = true; return; }
        let stat;
        try { stat = await fs.lstat(await workspace.resolve(rel)); } catch { continue; }
        if (stat.isDirectory()) { entries.push({ path: rel, kind: 'directory', bytes: 0 }); await walk(rel, depth + 1); }
        else if (stat.isFile()) entries.push({ path: rel, kind: 'file', bytes: stat.size });
      }
    };
    // Resolve the root through the same boundary checker before listing it.
    await workspace.resolve('__root_probe__', true); await walk();
    return { entries, files: entries.filter(e => e.kind === 'file').map(e => e.path), limits: projectLimits, truncated };
  }
  async file(id: string, owner: string, rel: unknown) {
    await this.get(id, owner); const content = await this.workspace(id).read(rel); return { path: String(rel), content, hash: digest(content), bytes: Buffer.byteLength(content) };
  }
  private async budget(id: string, owner: string, addedBytes: number, addedFiles = 0, addedEntries = 0) {
    const tree = await this.tree(id, owner);
    if (tree.truncated || tree.files.length + addedFiles > projectLimits.files || tree.entries.length + addedEntries > projectLimits.entries || tree.entries.reduce((n,e) => n + e.bytes, 0) + addedBytes > projectLimits.bytes) throw new Error('project_storage_limit');
  }
  async write(id: string, owner: string, body: any) {
    await this.get(id, owner, true); const workspace = this.workspace(id), rel = relativePath(body.path);
    if (rel.split('/').length > projectLimits.depth + 1) throw new Error('path_depth');
    const proposal = await workspace.proposal(rel, body.content);
    if (body.beforeHash !== proposal.beforeHash) throw new Error('stale_approval');
    await this.budget(id, owner, Buffer.byteLength(proposal.content) - Buffer.byteLength(proposal.before), proposal.beforeHash === null ? 1 : 0, proposal.beforeHash === null ? 1 : 0);
    const result = await workspace.apply(proposal); await this.audit(id, 'write', { path: rel, hash: result.sha256 }); return result;
  }
  async mkdir(id: string, owner: string, rel: unknown) {
    await this.get(id, owner, true); const value = relativePath(rel);
    if (value.split('/').length > projectLimits.depth) throw new Error('path_depth');
    await this.budget(id, owner, 0, 0, 1);
    const workspace = this.workspace(id); const result = await workspace.createDirectory(await workspace.directoryProposal(value)); await this.audit(id, 'mkdir', { path: value }); return result;
  }
  private async audit(id: string, action: string, data: Record<string, unknown>) {
    await fs.mkdir(path.join(this.root, 'project-audit'), { recursive: true, mode: 0o700 });
    await fs.appendFile(path.join(this.root, 'project-audit', projectId(id) + '.jsonl'), JSON.stringify({ at: new Date().toISOString(), action, ...data }) + '\n', { mode: 0o600 });
  }
  private async fingerprint(id: string, owner: string) {
    const tree = await this.tree(id, owner); if (tree.truncated) throw new Error('project_storage_limit');
    const rows = [];
    for (const entry of tree.entries) rows.push({ ...entry, hash: entry.kind === 'file' ? (await this.file(id, owner, entry.path)).hash : null });
    return digest(JSON.stringify(rows));
  }
  async preview(id: string, owner: string, input: unknown): Promise<ImportPreview> {
    await this.get(id, owner, true);
    if (id === 'demo') throw new Error('legacy_import_requires_new_project');
    for (const [key, stage] of this.stages) if (Date.parse(stage.preview.expires) < Date.now()) this.stages.delete(key);
    if (this.stages.size >= 20) throw new Error('import_limit');
    if (!Array.isArray(input) || !input.length || input.length > 1000) throw new Error('import_limit');
    const tree = await this.tree(id, owner), occupied = new Set(tree.entries.map(e => e.path));
    const entries: Stage['entries'] = [], skipped: ImportPreview['skipped'] = []; let bytes = 0;
    for (const candidate of input) {
      const rel = String(candidate?.path || '').slice(0, 241);
      try {
        relativePath(candidate.path);
        if (rel.split('/').length > projectLimits.depth + 1) throw new Error('path_depth');
        if (typeof candidate.content !== 'string' || candidate.content.includes('\0') || Buffer.byteLength(candidate.content) > projectLimits.fileBytes) throw new Error('text_file_limit');
        safeText(candidate.content);
        if (occupied.has(rel) || [...occupied].some(p => p.startsWith(rel + '/')) || rel.split('/').slice(0,-1).some((_,i,a) => entries.some(e => e.path === a.slice(0,i+1).join('/')) || tree.entries.some(e => e.kind === 'file' && e.path === a.slice(0,i+1).join('/')))) throw new Error('path_exists');
        const count = Buffer.byteLength(candidate.content);
        if (entries.length + tree.files.length >= projectLimits.files || bytes + count + tree.entries.reduce((n,e) => n + e.bytes,0) > projectLimits.bytes) throw new Error('project_storage_limit');
        entries.push({ path: rel, content: candidate.content }); occupied.add(rel); bytes += count;
      } catch (e: any) { skipped.push({ path: rel, reason: /^[a-z_]+$/.test(e.message) ? e.message : 'invalid_file' }); }
    }
    const preview: ImportPreview = { id: randomUUID(), files: entries.map(e => ({ path: e.path, bytes: Buffer.byteLength(e.content) })), skipped, bytes, expires: new Date(Date.now() + 600000).toISOString() };
    this.stages.set(preview.id, { project: id, owner, fingerprint: await this.fingerprint(id, owner), preview, entries }); return preview;
  }
  async commit(id: string, owner: string, stageId: unknown) {
    const item = await this.get(id, owner, true), stage = this.stages.get(String(stageId));
    if (!stage || stage.project !== id || stage.owner !== owner || Date.parse(stage.preview.expires) < Date.now()) throw new Error('import_expired');
    if (!stage.entries.length) throw new Error('import_empty');
    if (stage.fingerprint !== await this.fingerprint(id, owner)) throw new Error('stale_import');
    const staging = path.join(this.root, 'project-imports', stage.preview.id), content = path.join(staging, 'content'), backup = path.join(staging, 'before');
    await fs.mkdir(content, { recursive: true, mode: 0o700 });
    const tree = await this.tree(id, owner);
    try {
      for (const entry of tree.entries) {
        const target = path.join(content, entry.path);
        if (entry.kind === 'directory') await fs.mkdir(target, { recursive: true, mode: 0o700 });
        else { await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, (await this.file(id, owner, entry.path)).content, { mode: 0o600, flag: 'wx' }); }
      }
      for (const entry of stage.entries) { const target = path.join(content, entry.path); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, entry.content, { mode: 0o600, flag: 'wx' }); }
      const candidateTree = await this.treeAt(content); if (candidateTree > projectLimits.entries) throw new Error('project_storage_limit');
      await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify({project:id,created:new Date().toISOString()}),{mode:0o600,flag:'wx'});
      // No model is running for this project; the API admission lock also excludes other writes.
      await fs.rename(this.directory(id), backup);
      try { await fs.rename(content, this.directory(id)); } catch (e) { await fs.rename(backup, this.directory(id)); throw e; }
      item.source = 'import'; item.updated = new Date().toISOString(); item.revision = randomUUID(); await this.save(item);
      this.stages.delete(stage.preview.id); await this.audit(id, 'import', { files: stage.entries.length, bytes: stage.preview.bytes });
      return { imported: stage.entries.length, skipped: stage.preview.skipped, project: this.public(item) };
    } catch (e) { this.stages.delete(stage.preview.id); throw e; }
  }
  private async treeAt(root: string): Promise<number> {
    let count = 0;
    for (const e of await fs.readdir(root, { withFileTypes: true })) { count++; if (e.isDirectory()) count += await this.treeAt(path.join(root,e.name)); }
    return count;
  }
  async export(id: string, owner: string) {
    const item = await this.get(id, owner), tree = await this.tree(id, owner); if (tree.truncated) throw new Error('project_storage_limit');
    const files = []; for (const rel of tree.files) files.push({ path: rel, content: (await this.file(id, owner, rel)).content });
    return { version: 1, project: { name: item.name, description: item.description }, directories: tree.entries.filter(e => e.kind === 'directory').map(e => e.path), files };
  }
}
