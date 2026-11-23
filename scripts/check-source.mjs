import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const sources = ['apps', 'packages', 'services', 'deploy', 'examples', 'public', 'docs', 'scripts', 'tests'];
let checked = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules','dist','.runtime','__pycache__'].includes(entry.name)) visit(file);
    else if (/\.(tsx?|mjs|json|css|md|html|txt|py|ya?ml|service)$/.test(file)) {
      const body = fs.readFileSync(file, 'utf8'); checked++;
      assert(!/sk-[a-f\d]{32}\b/i.test(body), `Credential-like value in ${path.relative(root, file)}`);
      assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body), `Private material in ${path.relative(root, file)}`);
      assert(!/[A-Z]:[\\/]Users[\\/]/i.test(body), `Developer-specific path in ${path.relative(root, file)}`);
    }
  }
}
for (const name of sources) if (fs.existsSync(path.join(root, name))) visit(path.join(root, name));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/data.json')));
assert.equal(fixture.records.length, 0, 'Public examples must not contain actual user requests');
assert.equal(fixture.tests.length, 0, 'Private measured data is injected at build time');
console.log(`Source boundary checks passed: ${checked} files; examples contain no private measurements.`);
