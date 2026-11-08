import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ForgeCli } from './run.js';

/**
 * The hosts a forge CLI is signed in to on this machine (security review of the lot 8a push): the daemon reads a session's
 * `origin` on its own, every minute, so a repository cloned from any host must never make it call that host with the machine's
 * credentials. Only a host the user signed in to with `gh` / `glab` (their own config files), or named by the CLI's host variable,
 * is ever read; a public default host counts when a token for it is in the environment. Host names only: no token is read here.
 */
export async function signedInHosts(cli: ForgeCli, env: NodeJS.ProcessEnv): Promise<Set<string>> {
  const home = env.HOME || homedir();
  const config = env.XDG_CONFIG_HOME || join(home, '.config');
  const out = new Set<string>();
  const add = (h: string | undefined): void => { const v = h?.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase(); if (v) out.add(v); };
  if (cli === 'gh') {
    const text = await readFile(join(env.GH_CONFIG_DIR || join(config, 'gh'), 'hosts.yml'), 'utf8').catch(() => '');
    for (const m of text.matchAll(/^([A-Za-z0-9][\w.-]*):\s*$/gm)) add(m[1]);
    add(env.GH_HOST);
    if (env.GH_TOKEN || env.GITHUB_TOKEN) add('github.com');
  } else {
    const text = await readFile(join(env.GLAB_CONFIG_DIR || join(config, 'glab-cli'), 'config.yml'), 'utf8').catch(() => '');
    // The keys of the `hosts:` section, one indentation level down.
    let inHosts = false, indent = -1;
    for (const line of text.split('\n')) {
      if (/^hosts:\s*$/.test(line)) { inHosts = true; indent = -1; continue; }
      if (!inHosts || !line.trim() || line.trim().startsWith('#')) continue;
      const lead = line.length - line.trimStart().length;
      if (lead === 0) { inHosts = false; continue; }
      if (indent < 0) indent = lead;
      const m = lead === indent ? /^\s+([A-Za-z0-9][\w.-]*):\s*$/.exec(line) : null;
      if (m) add(m[1]);
    }
    add(env.GITLAB_HOST); add(env.GL_HOST);
    if (!env.GITLAB_HOST && !env.GL_HOST && (env.GITLAB_TOKEN || env.GL_TOKEN || env.GITLAB_ACCESS_TOKEN)) add('gitlab.com');
  }
  return out;
}
