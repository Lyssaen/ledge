import { realTmux, routedTmux, type Tmux } from '../tmux.js';
import { conptyPanes } from './conpty.js';

/** The panes the daemon drives agents in: ConPTY on Windows (no tmux there) or when `LEDGE_PANES=conpty`, else tmux,
 *  Ledge's own server for its sessions and the default one for OpenRig's seats. */
export function pickTmux(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, socket = 'ledge'): Tmux {
  if (platform === 'win32' || env.LEDGE_PANES === 'conpty') return conptyPanes();
  return routedTmux(realTmux(socket), realTmux(null));
}
