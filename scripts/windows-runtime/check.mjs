// Checks an assembled runtime with its own node.exe: the CLI answers its version, a real ConPTY pane opens and reports
// its exit code (node-pty loads conpty.node only then), the xterm packages load, Git Bash runs.
// Usage: node scripts/windows-runtime/check.mjs <runtime>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { layout } from './pins.mjs';

export function checkRuntime(out) {
  const L = layout(out);
  const version = readFileSync(L.version, 'utf8').trim();
  const said = execFileSync(L.node, [L.cli, '--version'], { encoding: 'utf8' }).trim();
  if (said !== version) throw new Error(`ledge --version said ${said}, expected ${version}`);
  const mod = (name) => JSON.stringify(join(L.ledge, 'node_modules', ...name.split('/')));
  // A pane as the pane host opens one: cmd.exe exits 7 inside a ConPTY, its code comes back through node-pty.
  const pane = `const pty = require(${mod('node-pty')}); const p = pty.spawn('cmd.exe', ['/c', 'exit 7'], {});` +
    `const t = setTimeout(() => { console.error('the pane never ended'); process.exit(3); }, 15000);` +
    `p.onExit(e => { clearTimeout(t); process.exit(e.exitCode === 7 ? 0 : 4); });`;
  execFileSync(L.node, ['-e', pane], { stdio: 'inherit' });
  execFileSync(L.node, ['-e', `require(${mod('@xterm/headless')}); require(${mod('@xterm/addon-serialize')})`], { stdio: 'inherit' });
  const ok = execFileSync(L.bash, ['-c', 'echo ok'], { encoding: 'utf8' }).trim();
  if (ok !== 'ok') throw new Error(`Git Bash said ${ok}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  checkRuntime(resolve(process.argv[2] ?? ''));
  console.log('runtime check passed');
}
