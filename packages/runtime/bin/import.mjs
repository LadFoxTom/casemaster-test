// Phase 12 — `cmsv import`.
// Copies the .cms source tree from a CaseMaster runtime layout into this
// project's app/ directory. Knows about the conventional CaseMaster
// folders (bo/, page/, script/, qualifier/) and skips runtime/ (the
// framework binaries, which we don't need) and incDevelopment.cms etc.
//
// Usage:
//   node tools/import.mjs --from C:/path/to/casemaster-runtime
//   node tools/import.mjs --from ../casemaster-runtime --dry-run

import { mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return a;
  }, [])
);
const FROM   = args.from;
const TO     = args.to ?? join(process.cwd(), 'app');
const DRY    = Boolean(args['dry-run']);

if (!FROM) {
  console.error('usage: node tools/import.mjs --from <casemaster-runtime-dir> [--to ./app] [--dry-run]');
  process.exit(1);
}

// Top-level dirs we *do* import. Anything else is framework or local
// state and gets skipped.
const KEEP_TOP = new Set(['bo', 'page', 'script', 'qualifier']);

const stats = { files: 0, dirs: 0, skipped: 0, bytes: 0 };

for (const entry of readdirSync(FROM)) {
  if (!KEEP_TOP.has(entry)) { stats.skipped++; continue; }
  const src = join(FROM, entry);
  if (!statSync(src).isDirectory()) { stats.skipped++; continue; }
  walkAndCopy(src, join(TO, entry));
}

console.log('--- import summary ---');
console.log(`from:    ${FROM}`);
console.log(`to:      ${TO}`);
console.log(`dirs:    ${stats.dirs}`);
console.log(`files:   ${stats.files}`);
console.log(`bytes:   ${stats.bytes.toLocaleString()}`);
console.log(`skipped: ${stats.skipped} (top-level non-cms dirs)`);
if (DRY) console.log('(dry run — no files written)');
console.log('\nnext: `npm run typecheck && npm test` to surface unsupported features.');

function walkAndCopy(src, dst) {
  if (!existsSync(src) || !statSync(src).isDirectory()) return;
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      stats.dirs++;
      walkAndCopy(s, d);
    } else if (entry.endsWith('.cms')) {
      stats.files++;
      stats.bytes += st.size;
      if (!DRY) {
        mkdirSync(dirname(d), { recursive: true });
        copyFileSync(s, d);
      }
      console.log(`  ${DRY ? '[dry] ' : ''}${relative(process.cwd(), d)}`);
    }
  }
}
