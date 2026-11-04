// Builds the runtime folder the snapshot Windows installer carries (spec 2026-11-03 §4.2.5): a pinned Node, this commit's
// Ledge daemon and CLI with their production dependencies (node-pty's Windows prebuild included), and PortableGit for
// Claude Code's Git Bash. Windows only. Usage: node scripts/windows-runtime/assemble.mjs <out>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, NODE, PORTABLE_GIT, verifySha256 } from './pins.mjs';

if (process.platform !== 'win32') { console.error('assemble.mjs runs on Windows (it extracts and runs Windows binaries)'); process.exit(2); }
const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: node scripts/windows-runtime/assemble.mjs <out>'); process.exit(2); }
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = join(dirname(out), '.cache');
const L = layout(out);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

/** The pinned file, from the cache when its hash matches, else downloaded and checked. */
async function fetchPinned(pin, name) {
  mkdirSync(cache, { recursive: true });
  const file = join(cache, name);
  if (existsSync(file)) { try { verifySha256(readFileSync(file), pin.sha256, name); return file; } catch { rmSync(file); } }
  const res = await fetch(pin.url);
  if (!res.ok) throw new Error(`download ${pin.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  verifySha256(buf, pin.sha256, name);
  writeFileSync(file, buf);
  return file;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Node: node.exe alone (Windows' tar reads the zip).
const nodeZip = await fetchPinned(NODE, `node-v${NODE.version}-win-x64.zip`);
const nodeTmp = join(cache, 'node-extract');
rmSync(nodeTmp, { recursive: true, force: true }); mkdirSync(nodeTmp);
run('tar', ['-xf', nodeZip, '-C', nodeTmp]);
cpSync(join(nodeTmp, `node-v${NODE.version}-win-x64`, 'node.exe'), L.node);

// PortableGit: a self-extracting 7-Zip archive.
const gitExe = await fetchPinned(PORTABLE_GIT, `PortableGit-${PORTABLE_GIT.version}-64-bit.7z.exe`);
run(gitExe, ['-y', `-o${L.git}`]);

// Ledge: this commit's build, its production dependencies from npm (@ledge/protocol is bundled into dist).
run('pnpm', ['--filter', '@paradow/ledge', 'build'], { cwd: repo, shell: true });
const pkgDir = join(repo, 'packages', 'ledge');
mkdirSync(L.ledge, { recursive: true });
cpSync(join(pkgDir, 'dist'), join(L.ledge, 'dist'), { recursive: true });
cpSync(join(pkgDir, 'assets'), join(L.ledge, 'assets'), { recursive: true });
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const { devDependencies: _dev, scripts: _scripts, ...shipped } = pkg;
writeFileSync(join(L.ledge, 'package.json'), JSON.stringify(shipped, null, 2) + '\n');
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: L.ledge, shell: true });
writeFileSync(L.version, `${pkg.version}\n`);

// Self-check with what was just assembled: the CLI answers its version, node-pty loads, Git Bash runs.
const said = execFileSync(L.node, [L.cli, '--version'], { encoding: 'utf8' }).trim();
if (said !== pkg.version) throw new Error(`ledge --version said ${said}, expected ${pkg.version}`);
execFileSync(L.node, ['-e', `require(${JSON.stringify(join(L.ledge, 'node_modules', 'node-pty'))})`], { stdio: 'inherit' });
const ok = execFileSync(L.bash, ['-c', 'echo ok'], { encoding: 'utf8' }).trim();
if (ok !== 'ok') throw new Error(`Git Bash said ${ok}`);
console.log(`runtime ready in ${out}: Ledge ${pkg.version}, Node ${NODE.version}, PortableGit ${PORTABLE_GIT.version}`);
