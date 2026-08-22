import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const skipDirs = new Set(['.git', 'node_modules', 'out']);
const allowedData = new Set(['data/example-statement.json']);
const findings = [];

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) await walk(full);
      continue;
    }
    if (rel.startsWith('data/') && rel.endsWith('.json') && !allowedData.has(rel)) {
      findings.push(`${rel}: real/local statement JSON should not be committed`);
    }
    if (rel === 'config/runtime-category-overrides.json') {
      findings.push(`${rel}: local runtime override file should not be committed`);
    }
    if (/\.(zip|png|jpg|jpeg|pdf|gif|webp)$/i.test(rel)) continue;
    let text;
    try { text = await fs.readFile(full, 'utf8'); } catch { continue; }
    if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text)) {
      findings.push(`${rel}: looks like a JWT/token`);
    }
    if (/cf_clearance\s*=\s*(?!REPLACE|YOUR_)[A-Za-z0-9._-]{24,}/i.test(text)) {
      findings.push(`${rel}: looks like a real cf_clearance value`);
    }
  }
}

await walk(root);
if (findings.length) {
  console.error('Repository safety check FAILED:\n');
  for (const item of findings) console.error(`- ${item}`);
  process.exit(2);
}
console.log('Repository safety check passed: no obvious tokens/cookies or real statement JSON found.');
