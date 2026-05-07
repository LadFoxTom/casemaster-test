#!/usr/bin/env node
/**
 * Scaffold runner. `npm create cms-vercel my-app` lands here via npm's
 * create-* convention. Copies the bundled `template/` tree to <my-app>,
 * substitutes the {{name}} placeholder in package.json, prints next
 * steps. Optionally runs `cms-vercel-import --from <path>` afterwards
 * to populate `app/` from an existing CaseMaster runtime.
 *
 * Usage:
 *   npm create cms-vercel my-app
 *   npm create cms-vercel my-app -- --from /path/to/casemaster-runtime
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith('--'));
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const target = positional[0];
if (!target) {
  console.error('usage: npm create cms-vercel <my-app> [-- --from <casemaster-runtime>]');
  process.exit(1);
}
const fromRuntime = flag('from');

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(here, '..', 'template');
const targetDir = resolve(process.cwd(), target);

if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
  console.error(`refusing to scaffold into non-empty directory: ${targetDir}`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });

let copied = 0;
copyTree(templateDir, targetDir);
console.log(`✓ ${copied} files copied to ${targetDir}`);

// Substitute the project name in package.json + README.md.
const projectName = target.split(/[\\/]/).pop();
substitute(join(targetDir, 'package.json'), { name: projectName });
substitute(join(targetDir, 'README.md'),    { name: projectName });

// Some files need renaming on copy: gitignore.tpl → .gitignore (npm strips
// dotfiles from published bundles).
renameIfPresent(join(targetDir, 'gitignore.tpl'),    join(targetDir, '.gitignore'));
renameIfPresent(join(targetDir, 'env.example.tpl'),  join(targetDir, '.env.example'));

if (fromRuntime && fromRuntime !== true) {
  console.log(`\nimporting from ${fromRuntime} …`);
  const r = spawnSync('node', [
    require.resolve ? require.resolve('cms-vercel/bin/import.mjs')
      : resolve(here, '..', '..', 'runtime', 'bin', 'import.mjs'),
    '--from', fromRuntime,
    '--to',   join(targetDir, 'app'),
  ], { stdio: 'inherit' });
  if (r.status !== 0) console.warn('import returned non-zero — see output above');
}

console.log(`
Next steps:

  cd ${target}
  npm install
  cp .env.example .env.local        # fill DATABASE_URL
  npx vercel link                   # one-time, links to a Vercel project
  npm run dev                       # http://localhost:3000

Then push to GitHub or Bitbucket and connect the repo on Vercel for
auto-deploy. Full docs: https://github.com/LadFoxTom/Casemaster-Vercel`);

// ─── helpers ───────────────────────────────────────────────────────
function copyTree(src, dst) {
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else {
      copyFileSync(s, d);
      copied++;
    }
  }
}
function substitute(path, vars) {
  if (!existsSync(path)) return;
  let s = readFileSync(path, 'utf8');
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(String(v));
  writeFileSync(path, s);
}
function renameIfPresent(from, to) {
  if (!existsSync(from)) return;
  writeFileSync(to, readFileSync(from));
  // best-effort cleanup; ignore errors
  try { (require ?? (() => null))(); } catch {}
}
