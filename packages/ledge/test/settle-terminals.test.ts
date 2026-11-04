import { describe, expect, it } from 'vitest';
import { settleTerminals } from '../src/daemon/index.js';

describe('settleTerminals', () => {
  it('kills the shells a stopped daemon left and gives the sessions their window size back', async () => {
    const killed: string[] = [];
    const unset: string[] = [];
    const tmux = {
      killSession: async (n: string) => { killed.push(n); },
      unsetWindowOption: async (n: string, o: string) => { unset.push(`${n} ${o}`); }
    };
    const live = new Set(['ledge-a', 'sh-0123456789ab', 'sh-not-a-shell', 'ledge-gone-b']);
    await settleTerminals(tmux, live, [{ tmuxSession: 'ledge-a' }, { tmuxSession: 'ledge-missing' }, { tmuxSession: 'dev@rig' }, { tmuxSession: null }]);
    expect(killed).toEqual(['sh-0123456789ab']);
    expect(unset).toEqual(['ledge-a window-size']);
  });
});
