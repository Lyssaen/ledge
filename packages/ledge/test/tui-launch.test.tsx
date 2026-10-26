import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Launch } from '../src/tui/screens/Launch.js';
import { TuiContext } from '../src/tui/context.js';
import { MESSAGES } from '../src/tui/i18n/lang.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import type { LaunchPrefill } from '../src/tui/model/catalog.js';

/** « Nouvelle session » alone, on a context whose machines the mock daemon cannot draw (its own machine offline). */
function launchOn(machines: Array<{ id: string; label: string; ready: boolean }>, prefill: LaunchPrefill) {
  const send = vi.fn();
  const toasts: string[] = [];
  const ctx = {
    client: { send, onMessage: () => () => {} }, d: { sessions: [], errors: [], status: 'open' },
    machines: machines.map(m => ({ ...m, recents: [], daemon: { models: false } })),
    projects: { projects: [{ id: 'a', name: 'A', color: 'blue', repos: [{ machine: 'local', path: '/w/a' }] }], rules: [] },
    catalog: { current: { launch: prefill } }, t: MESSAGES.fr, g: glyphsFor({}), small: false, editing: true, setEditing: () => {},
    toast: (x: { text: string }) => { toasts.push(x.text); }, go: () => {}, select: () => {}
  };
  const ui = render(<TuiContext.Provider value={ctx as never}><Launch /></TuiContext.Provider>);
  const press = async (s: string) => { ui.stdin.write(s); await new Promise(r => setTimeout(r, 30)); };
  return { ui, send, toasts, press };
}

describe('ledge tui: « Nouvelle session » opened from « Équipes » (#97, #99)', () => {
  it('a folder read on a machine offline is not launched on another one', async () => {
    const role = { id: 'review', label: 'Relecteur', prompt: 'Tu relis.', tool: 'claude' as const, source: 'repo' as const, path: '/w/a/.ledge/roles/review.md' };
    const { ui, send, toasts, press } = launchOn([{ id: 'local', label: 'Local', ready: false }, { id: 'server', label: 'Server', ready: true }], { cwd: '/w/a', machine: 'local', project: 'a', role });
    try {
      await new Promise(r => setTimeout(r, 50));
      expect(ui.lastFrame()).not.toMatch(/· Server ·/);
      await press('Relis');
      await press('\u0013'); // ctrl+s
      expect(send.mock.calls.map(x => x[0]).filter(m => m.type === 'session.launch')).toEqual([]);
      expect(toasts).toContain('Aucune machine en ligne.');
    } finally { ui.unmount(); }
  });
});
