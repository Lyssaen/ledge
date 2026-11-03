import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { BrowserEnabled } from '@ledge/protocol';

export const LIVE_FLAG = '--remote-debugging-port=0';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The Playwright MCP config Claude Code makes its Playwright servers load: `PLAYWRIGHT_MCP_CONFIG` in the `env` of
 * `~/.claude/settings.json`. Null when it sets none: Ledge then has no file it may change.
 */
export async function playwrightConfigPath(home: string): Promise<string | null> {
  let settings: unknown;
  try { settings = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8')); } catch { return null; }
  const raw = isObject(settings) && isObject(settings.env) ? settings.env.PLAYWRIGHT_MCP_CONFIG : undefined;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const p = raw.trim();
  if (p === '~') return null;
  if (p.startsWith('~/')) return resolve(home, p.slice(2));
  return isAbsolute(p) ? p : null;
}

/**
 * « Activer le direct… », after the person's confirmation: adds `--remote-debugging-port=0` to the config's
 * `browser.launchOptions.args`, keeping everything else (a missing file is created with that line only). Each agent's
 * Playwright browser then opens a CDP port on 127.0.0.1, which Ledge watches. Playwright reads its config when its server
 * starts: the line applies to the sessions started after it. Never called without the person's confirmation.
 */
/** One « Activer le direct » at a time: a second one, asked together, finds the line there (`already`). */
let turn: Promise<unknown> = Promise.resolve();
export function enableLive(rid: string, home: string): Promise<BrowserEnabled> {
  const run = turn.then(() => enableOnce(rid, home), () => enableOnce(rid, home));
  turn = run.catch(() => {});
  return run;
}

async function enableOnce(rid: string, home: string): Promise<BrowserEnabled> {
  const path = await playwrightConfigPath(home);
  if (!path) return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'not_configured' };
  let text: string | null;
  try { text = await readFile(path, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path };
    text = null;
  }
  let config: unknown = {};
  if (text !== null && text.trim()) {
    try { config = JSON.parse(text); } catch { return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path }; }
  }
  // Only a shape Ledge can add to: objects where objects go, a list of strings for the arguments.
  if (!isObject(config)) return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path };
  const browser = config.browser ?? {};
  if (!isObject(browser)) return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path };
  const launch = browser.launchOptions ?? {};
  if (!isObject(launch)) return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path };
  const args = launch.args ?? [];
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path };
  if ((args as string[]).some(a => a === '--remote-debugging-port' || a.startsWith('--remote-debugging-port='))) return { type: 'browser.enabled', rid, outcome: 'already', path };
  const next = { ...config, browser: { ...browser, launchOptions: { ...launch, args: [...(args as string[]), LIVE_FLAG] } } };
  // Written as it was: on one line when it was, indented otherwise; then put in place whole.
  const out = text !== null && text.trim() && !text.trim().includes('\n') ? JSON.stringify(next) : JSON.stringify(next, null, 2);
  try {
    // A config kept elsewhere behind a link stays there: the file it points to is the one rewritten.
    const target = await realpath(path).catch(() => path);
    await mkdir(dirname(target), { recursive: true });
    // The file keeps its permissions; a new one is the owner's only. The copy is made private before anything is in it.
    const mode = text === null ? 0o600 : (await stat(target)).mode & 0o777;
    // A name no one else uses; written through the descriptor opened private, so that nothing can make it readable before
    // its final mode; removed on failure only when this call made it.
    const tmp = `${target}.ledge-${randomUUID()}.tmp`;
    let made = false;
    try {
      const fh = await open(tmp, 'wx', 0o600);
      made = true;
      try {
        await fh.chmod(0o600);
        await fh.writeFile(`${out}\n`);
        await fh.chmod(mode);
      } finally { await fh.close(); }
      await rename(tmp, target);
    } catch (e) { if (made) await unlink(tmp).catch(() => {}); throw e; }
  } catch { return { type: 'browser.enabled', rid, outcome: 'refused', reason: 'write_failed', path }; }
  return { type: 'browser.enabled', rid, outcome: 'enabled', path };
}
