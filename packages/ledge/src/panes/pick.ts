import { realTmux, routedTmux, type Tmux } from '../tmux.js';
import { readDaemonToken } from '../auth.js';
import { paths } from '../paths.js';
import { conptyPanes } from './conpty.js';
import { paneHostClient, startDetachedHost } from './client.js';
import { panehostPath } from './protocol.js';

/** The panes the daemon drives agents in: on Windows (no tmux there) the pane host, which outlives the daemon
 *  (`LEDGE_PANES=panehost` anywhere); ConPTY panes inside this process with `LEDGE_PANES=conpty` (tests); else tmux,
 *  Ledge's own server for its sessions and the default one for OpenRig's seats. */
export function pickTmux(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, socket = 'ledge'): Tmux {
  if (env.LEDGE_PANES === 'conpty') return conptyPanes();
  if (usesPaneHost(platform, env)) return paneHostClient({ path: panehostPath(platform, env, paths().dir), token: readDaemonToken, start: startDetachedHost });
  return routedTmux(realTmux(socket), realTmux(null));
}

/** Agents run in the pane host (`ledge panehost`): on Windows, where there is no tmux, or anywhere with
 *  `LEDGE_PANES=panehost` (tests). */
export function usesPaneHost(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === 'win32' || env.LEDGE_PANES === 'panehost';
}
