import { describe, expect, it } from 'vitest';
import { settleTerminals } from '../src/daemon/index.js';

/** A tmux whose windows have options: `opts[name]` is what `show-options -w` would print for each option. */
function fakeTmux(opts: Record<string, Record<string, string>>) {
  const killed: string[] = [];
  const calls: string[] = [];
  return {
    killed, calls, opts,
    killSession: async (n: string) => { killed.push(n); },
    windowOption: async (n: string, o: string) => opts[n]?.[o] ?? null,
    setWindowOption: async (n: string, o: string, v: string) => { calls.push(`set ${n} ${o} ${v}`); (opts[n] ??= {})[o] = v; },
    // As tmux does, a resize sets the window to `manual`.
    resizeWindow: async (n: string, c: number, r: number) => { calls.push(`resize ${n} ${c}x${r}`); (opts[n] ??= {})['window-size'] = 'manual'; },
    unsetWindowOption: async (n: string, o: string) => { calls.push(`unset ${n} ${o}`); delete opts[n]?.[o]; }
  };
}

describe('settleTerminals', () => {
  it('kills the shells a stopped daemon left and gives the sessions their window size back', async () => {
    const tmux = fakeTmux({});
    const live = new Set(['ledge-a', 'sh-0123456789ab', 'sh-not-a-shell', 'ledge-gone-b']);
    await settleTerminals(tmux, live, [{ tmuxSession: 'ledge-a' }, { tmuxSession: 'ledge-missing' }, { tmuxSession: 'dev@rig' }, { tmuxSession: null }]);
    expect(tmux.killed).toEqual(['sh-0123456789ab']);
    // A Ledge session without a mark (an older daemon held it) loses its option, as before; a seat without a mark is not touched.
    expect(tmux.calls).toEqual(['unset ledge-a window-size']);
  });

  it('gives a window Ledge held exactly its own size back, a seat\'s included, and touches no other seat', async () => {
    const tmux = fakeTmux({
      'dev-build@starter': { 'window-size': 'manual', '@ledge_window_size': 'smallest:115x30' },
      'dev-plan@starter': { 'window-size': 'manual', '@ledge_window_size': 'manual:120x40' },
      'dev-review@starter': { 'window-size': 'manual', '@ledge_window_size': '-' },
      'dev-qa@starter': { 'window-size': 'manual' },
      'ledge-a': { 'window-size': 'manual', '@ledge_window_size': 'largest' },
      'dev-odd@starter': { 'window-size': 'manual', '@ledge_window_size': 'huge;kill-server' }
    });
    const live = new Set(Object.keys(tmux.opts));
    await settleTerminals(tmux, live, [{ tmuxSession: 'ledge-a' }, { tmuxSession: 'dev-build@starter' }]);
    expect(tmux.opts['dev-build@starter']).toEqual({ 'window-size': 'smallest' });
    // A window that was `manual` of its own gets its dimensions back, then its own `manual`.
    expect(tmux.opts['dev-plan@starter']).toEqual({ 'window-size': 'manual' });
    expect(tmux.calls.filter(c => c.includes('dev-plan@starter'))).toEqual(['resize dev-plan@starter 120x40', 'set dev-plan@starter window-size manual', 'unset dev-plan@starter @ledge_window_size']);
    expect(tmux.calls).toContain('resize dev-build@starter 115x30');
    expect(tmux.opts['dev-review@starter']).toEqual({});
    // Never held by Ledge (no mark): its `manual` is someone else's, it stays.
    expect(tmux.opts['dev-qa@starter']).toEqual({ 'window-size': 'manual' });
    // Given back from the mark, not removed by the older rule afterwards.
    expect(tmux.opts['ledge-a']).toEqual({ 'window-size': 'largest' });
    // A mark that is not a size is never written back: the window follows its server again.
    expect(tmux.opts['dev-odd@starter']).toEqual({});
  });
});
