import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const sections = ['# Third-party dependency notices\n\nGenerated from the locked npm dependency tree. Project code uses MIT; dependency licenses remain independent. UI primitives combine local Radix wrappers and explicitly authorized Harness source (MIT); see docs/component-provenance.json.\n'];
for (const [entry, metadata] of Object.entries(lock.packages)) {
  if (!entry || !entry.includes('node_modules/') || metadata.link || !existsSync(entry)) continue;
  const manifest = JSON.parse(readFileSync(path.join(entry, 'package.json'), 'utf8'));
  const files = readdirSync(entry).filter(name => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name));
  sections.push(`## ${manifest.name} ${manifest.version}\n\nDeclared license: ${metadata.license || manifest.license || 'See package'}\n`);
  for (const file of files) {
    try { sections.push(`### ${file}\n\n\x60\x60\x60text\n${readFileSync(path.join(entry, file), 'utf8')}\n\x60\x60\x60\n`); } catch { /* License directory; declaration retained above. */ }
  }
}
writeFileSync('THIRD_PARTY_NOTICES.md', sections.join('\n'));
console.log('Wrote dependency notices for', sections.filter(s => s.startsWith('## ')).length, 'locked packages');
