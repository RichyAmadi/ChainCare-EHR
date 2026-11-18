// Installs and builds backend + frontend from the repository root.
// Runs from both `postinstall` (so a bare `yarn` / `npm install` on Render works)
// and `build`. A marker file stops the second invocation repeating the work.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const marker = join(root, '.build-complete');
const fromPostinstall = process.env.npm_lifecycle_event === 'postinstall';

if (process.env.SKIP_ROOT_BUILD === '1') {
  console.log('[build] SKIP_ROOT_BUILD=1, skipping');
  process.exit(0);
}
// `install && build` would otherwise build twice: the build step consumes
// the marker left by postinstall and skips.
if (!fromPostinstall && existsSync(marker)) {
  rmSync(marker);
  console.log('[build] already built by postinstall, skipping');
  process.exit(0);
}

const run = (cmd) => {
  console.log(`[build] ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
};

// --include=dev: NODE_ENV=production would otherwise omit TypeScript and Vite.
run('npm ci --prefix backend --include=dev');
run('npm ci --prefix frontend --include=dev');
run('npm --prefix frontend run build');
run('npm --prefix backend run build');

if (fromPostinstall) writeFileSync(marker, new Date().toISOString());
console.log('[build] done');
