import { readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { paths } from '../paths.js';
import { log, quote } from '../log.js';

export interface MobileConfig { origin: string; rpID: string }

/** The origin the phone reaches Ledge at (WebAuthn needs it fixed): https, host only, default port. `rpID` is its host name. */
export function parseOrigin(input: string): MobileConfig {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new Error(`not a valid URL: ${input}`); }
  if (u.protocol !== 'https:') throw new Error('the origin must be https');
  if (u.username || u.password) throw new Error('the origin must not carry credentials');
  if (u.port) throw new Error('the origin must use the standard https port');
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('the origin must be a host only, without path, query or fragment');
  return { origin: u.origin, rpID: u.hostname };
}

/** A missing file means mobile access is off. A broken one too, and it is logged: the daemon loads it once, at startup. */
export async function loadMobileConfig(path: string = paths().mobile): Promise<MobileConfig | null> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); } catch { return null; }
  try {
    const j = JSON.parse(raw) as { origin?: unknown };
    if (typeof j.origin !== 'string') throw new Error('no origin');
    return parseOrigin(j.origin);
  } catch (e) {
    log(`mobile.json unreadable, mobile access stays off: ${quote((e as Error).message)}`);
    return null;
  }
}

/** Written atomically, readable by its owner only. `null` removes the file. */
export async function saveMobileConfig(cfg: MobileConfig | null, path: string = paths().mobile): Promise<void> {
  if (cfg === null) { await rm(path, { force: true }); return; }
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ origin: cfg.origin, rpID: cfg.rpID }, null, 2) + '\n', { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}
