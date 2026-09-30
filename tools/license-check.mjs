#!/usr/bin/env node
// Fails if any installed npm package declares a copyleft license.
// Usage: node ../tools/license-check.mjs   (run inside api/ or web/ after npm install)
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|EUPL|CDDL|OSL|SSPL|CC-BY-SA|CPAL|RPL)\b/i;
// Installed as an optional dependency of Next.js but removed from the shipped image (see web/Dockerfile).
const NOT_SHIPPED = [/^@img\/sharp-libvips/, /^@img\/sharp-wasm/];

const seen = new Map();
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (name.startsWith('@')) { walk(p); continue; }
    const pkgFile = join(p, 'package.json');
    if (!existsSync(pkgFile) || !statSync(p).isDirectory()) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
      let lic = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type ?? l).join(' OR ') : pkg.licenses?.type);
      if (typeof lic === 'object' && lic) lic = lic.type;
      seen.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, license: String(lic ?? 'UNKNOWN') });
    } catch { /* ignore broken package.json */ }
    walk(join(p, 'node_modules'));
  }
}
walk('node_modules');

/** "(MIT OR GPL-3.0)" is fine: we can pick MIT. Fail only if every alternative is copyleft. */
function isCopyleft(lic) {
  const alternatives = lic.replace(/[()]/g, '').split(/\s+OR\s+|\//i);
  return alternatives.every((a) => COPYLEFT.test(a));
}

const counts = {};
const bad = [];
const unknown = [];
for (const [id, { name, license }] of seen) {
  counts[license] = (counts[license] ?? 0) + 1;
  if (license === 'UNKNOWN' || license === 'undefined') unknown.push(id);
  else if (isCopyleft(license) && !NOT_SHIPPED.some((r) => r.test(name))) bad.push(`${id}: ${license}`);
}
console.log(`Checked ${seen.size} packages.`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${n.toString().padStart(4)}  ${l}`).join('\n'));
if (unknown.length) console.log(`\nNo license field (check manually): ${unknown.join(', ')}`);
if (bad.length) {
  console.error(`\nCOPYLEFT LICENSES FOUND:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('\nNo copyleft licenses.');
