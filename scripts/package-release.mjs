import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd(), source = path.join(root, 'dist'), target = path.join(root, '.runtime', 'release');
for (const name of ['index.html', 'chat.html', 'assets']) {
  if (!existsSync(path.join(source, name))) throw new Error('Run the production build first');
}
// Only this owned staging directory is replaced. Never package the parent workspace.
rmSync(target, { recursive: true, force: true });
for (const surface of ['dashboard', 'chat']) {
  const dir = path.join(target, surface); mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(source, surface === 'chat' ? 'chat.html' : 'index.html'), path.join(dir, 'index.html'));
  mkdirSync(path.join(dir, 'assets'));
  for (const entry of readdirSync(path.join(source, 'assets'), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|css|woff2|svg)$/.test(entry.name)) continue;
    copyFileSync(path.join(source, 'assets', entry.name), path.join(dir, 'assets', entry.name));
  }
}
console.log('Prepared dashboard/ and chat/ in .runtime/release');
