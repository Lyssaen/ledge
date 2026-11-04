// Regenerates scripts/windows-runtime/package-lock.json, the lockfile the Windows runtime is installed from (npm ci):
// every production dependency of packages/ledge, transitive ones included, fixed in the commit. Run it when
// packages/ledge's dependencies change (test/windows-runtime.test.ts says so). Usage: node scripts/windows-runtime/lock.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shippedPackage } from './pins.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, '..', '..', 'packages', 'ledge', 'package.json'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'ledge-runtime-lock-'));
writeFileSync(join(dir, 'package.json'), JSON.stringify(shippedPackage(pkg), null, 2) + '\n');
execFileSync('npm', ['install', '--package-lock-only', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
copyFileSync(join(dir, 'package-lock.json'), join(here, 'package-lock.json'));
rmSync(dir, { recursive: true, force: true });
console.log('scripts/windows-runtime/package-lock.json written');
