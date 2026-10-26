import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ledgeDir } from '../paths.js';

/**
 * The Windows Terminal profile `ledge tui` runs in. A tab's icon comes only from its profile (no escape sequence, no
 * `wt.exe` flag sets it), so Ledge installs one, as a JSON fragment that needs no admin right, and opens the TUI there.
 */
export const PROFILE = 'Ledge';

/** The mascot, next to the package root: `dist/cli/index.js` and `src/tui/` both sit two levels down. */
const ICON = fileURLToPath(new URL('../../assets/ledge.ico', import.meta.url));

/** Where Windows Terminal keeps its settings, store, preview and unpackaged builds, under %LOCALAPPDATA%. */
const SETTINGS = [
  'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json',
  'Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json',
  'Microsoft/Windows Terminal/settings.json'
];

const fragmentDir = (localAppData: string) => join(localAppData, 'Microsoft', 'Windows Terminal', 'Fragments', PROFILE);

/** The profile's id, which Windows Terminal derives from the fragment's folder and the profile's name. */
const PROFILE_ID = '{d10fee13-0978-595f-a851-b60ec80f11c9}';

/** True when `ledge tui` should move to a Ledge tab: under Windows Terminal from WSL, not inside tmux (whose tab is not
 *  Ledge's), not already in a Ledge tab (`--here`, or the profile's id, should a stale profile drop `--here`), and from
 *  the built CLI (a `.ts` script under `pnpm dev` cannot be relaunched). */
export function movesToLedgeTab(env: NodeJS.ProcessEnv, here: boolean, script: string): boolean {
  return !here && !!env.WT_SESSION && !!env.WSL_DISTRO_NAME && !env.TMUX && env.WT_PROFILE_ID !== PROFILE_ID && !script.endsWith('.ts');
}

/** One `commandline` argument: quoted when it holds a space; null when Windows could not hand it back intact. */
function winArg(s: string): string | null {
  if (!s || /["\u0000-\u001f]/.test(s) || s.endsWith('\\')) return null;
  return /\s/.test(s) ? `"${s}"` : s;
}

/** The profile's command: the launcher inside `distro`, run as is (`--exec`, no shell reads the path). It stays the
 *  same when node or the CLI move, as Windows Terminal does not reread a fragment it has loaded once. */
export function profileCommandline(distro: string, launcher: string): string | null {
  const args = ['wsl.exe', '-d', distro, '--cd', '~', '--exec', '/bin/sh', launcher].map(winArg);
  return args.every(a => a !== null) ? args.join(' ') : null;
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The launcher: this CLI's `tui --here` with this node, and the Ledge folder when it is not the default one. */
export function launcherScript(node: string, script: string, ledgeHome?: string): string {
  const home = ledgeHome ? `export LEDGE_HOME=${shQuote(ledgeHome)}\n` : '';
  return `#!/bin/sh\n# Written by \`ledge tui\`: the Ledge profile of Windows Terminal runs it.\n${home}exec ${shQuote(node)} ${shQuote(script)} tui --here\n`;
}

/** The fragment file: one profile, the mascot as its icon (a Windows path, the fragment is read by Windows). */
export function fragment(commandline: string, iconWin: string): string {
  return `${JSON.stringify({ profiles: [{ name: PROFILE, commandline, icon: iconWin }] }, null, 2)}\n`;
}

/** True once Windows Terminal has read the fragment: it then lists the profile in its settings, under its source. */
export async function profileLoaded(localAppData: string): Promise<boolean> {
  for (const rel of SETTINGS) {
    const text = await readFile(join(localAppData, rel), 'utf8').catch(() => '');
    if (new RegExp(`"source"\\s*:\\s*"${PROFILE}"`).test(text)) return true;
  }
  return false;
}

async function writeIfChanged(path: string, content: Buffer | string): Promise<boolean> {
  const current = await readFile(path).catch(() => null);
  if (current && current.equals(Buffer.from(content))) return false;
  await writeFile(path, content);
  return true;
}

export interface LedgeTab {
  /** %LOCALAPPDATA%, as Windows writes it and as WSL reaches it. */
  localAppData: { win: string; linux: string };
  distro: string;
  node: string;
  script: string;
  /** Where the launcher goes, in the distro. */
  launcher: string;
  ledgeHome?: string;
  icon?: string;
  /** Runs `wt.exe` with these arguments. */
  wt(args: string[]): Promise<void>;
  /** How long a freshly written fragment is waited for. */
  waitMs?: number;
}

/**
 * Installs (or updates) the Ledge profile, then opens `ledge tui` in a new tab of it, in this window. False when the TUI
 * should stay in this tab: a path Windows cannot carry, or Windows Terminal not having read the fragment in time
 * (the next `ledge tui` finds it read).
 */
export async function openInLedgeTab(o: LedgeTab): Promise<boolean> {
  const commandline = profileCommandline(o.distro, o.launcher);
  if (!commandline) return false;
  await mkdir(dirname(o.launcher), { recursive: true });
  await writeIfChanged(o.launcher, launcherScript(o.node, o.script, o.ledgeHome));
  const dir = fragmentDir(o.localAppData.linux);
  await mkdir(dir, { recursive: true });
  await writeIfChanged(join(dir, 'ledge.ico'), await readFile(o.icon ?? ICON));
  const iconWin = `${o.localAppData.win}\\Microsoft\\Windows Terminal\\Fragments\\${PROFILE}\\ledge.ico`;
  await writeIfChanged(join(dir, 'ledge.json'), fragment(commandline, iconWin));
  // Windows Terminal reads a new fragment within a second or so; asked before, it opens its default profile instead.
  const deadline = Date.now() + (o.waitMs ?? 3000);
  while (!(await profileLoaded(o.localAppData.linux))) {
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, 100));
  }
  await o.wt(['-w', '0', 'new-tab', '-p', PROFILE]);
  return true;
}

const run = promisify(execFile);

/** The real machine: %LOCALAPPDATA% asked to cmd.exe (from C:, as a WSL directory is a UNC path cmd refuses), wt.exe beside it. */
export async function openTuiInLedgeTab(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const cmd = '/mnt/c/Windows/System32/cmd.exe';
    const win = (await run(cmd, ['/d', '/c', 'echo %LOCALAPPDATA%'], { cwd: '/mnt/c', timeout: 5000 })).stdout.trim();
    if (!/^[A-Za-z]:\\/.test(win)) return false;
    const linux = (await run('wslpath', ['-u', win], { timeout: 5000 })).stdout.trim();
    return await openInLedgeTab({
      localAppData: { win, linux },
      distro: env.WSL_DISTRO_NAME!,
      node: await realpath(process.execPath),
      script: await realpath(process.argv[1]!),
      launcher: join(ledgeDir(), 'tui.sh'),
      ledgeHome: env.LEDGE_HOME,
      wt: args => new Promise((resolve, reject) => {
        const child = spawn(join(linux, 'Microsoft', 'WindowsApps', 'wt.exe'), args, { cwd: '/mnt/c', stdio: 'ignore', detached: true });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      })
    });
  } catch { return false; }
}
