import { describe, it, expect, vi } from 'vitest';
import { until } from './helpers.js';
import type { ThreadItem } from '@ledge/protocol';
import { mockupSessions, startTui } from './tui-fixture.js';
import { PROJECT_COLORS } from '@ledge/protocol';
import { PALETTES } from '../src/tui/theme.js';

// Colours in the frames: chalk reads it when first loaded, so before the imports.
vi.hoisted(() => { process.env.FORCE_COLOR = '3'; process.env.COLORTERM = 'truecolor'; });

// Of today: the fleet keeps only the day's conversation.
const now = (s: number) => new Date(Date.now() + s * 1000).toISOString();

describe('ledge tui: the theme (#95 lot D)', () => {
  const DOWN = '\u001b[B', RIGHT = '\u001b[C';
  /** The truecolor sequences Ink writes for a colour, as text or as background. */
  const fgOf = (hex: string) => `38;2;${hex.slice(1).match(/../g)!.map(x => parseInt(x, 16)).join(';')}m`;
  const bgOf = (hex: string) => `48;2;${hex.slice(1).match(/../g)!.map(x => parseInt(x, 16)).join(';')}m`;

  it('auto on a light background: the light palette, the status bar and the text included', async () => {
    const tui = await startTui({ background: 'light' });
    try {
      expect(tui.frame()).toContain(bgOf(PALETTES.light.bar));
      expect(tui.frame()).toContain(fgOf(PALETTES.light.coral));
      expect(tui.frame()).not.toContain(fgOf(PALETTES.dark.fg));
    } finally { await tui.cleanup(); }
  });

  it('a theme forced at start: the background was not asked, Auto reads alone', async () => {
    const tui = await startTui({ theme: 'dark' });
    try {
      await tui.press(',');
      await until(() => tui.frame().includes('RÉGLAGES'));
      expect(tui.frame()).toContain('Auto ');
      expect(tui.frame()).not.toContain('Auto (fond');
    } finally { await tui.cleanup(); }
  });

  it('forced light at start, then Auto: the background unknown, the tone drawn stays', async () => {
    const tui = await startTui({ theme: 'light' });
    try {
      await tui.press(',');
      await until(() => tui.frame().includes('RÉGLAGES'));
      await tui.press(DOWN); await tui.press(RIGHT);
      await until(() => tui.themes.length === 1);
      expect(tui.themes).toEqual(['auto']);
      expect(tui.frame()).toContain(bgOf(PALETTES.light.bar));
      expect(tui.frame()).not.toContain(bgOf(PALETTES.dark.bar));
    } finally { await tui.cleanup(); }
  });

  it('New session: the project\'s ■ in its colour, its name not', async () => {
    const tui = await startTui();
    try {
      await tui.press('+');
      await until(() => tui.frame().includes('NOUVELLE SESSION'));
      const f = tui.frame();
      expect(f).toContain(`${fgOf(PROJECT_COLORS.blue)}■`);
      expect(f).toContain(`${fgOf(PROJECT_COLORS.green)}■`);
      expect(f).not.toContain(`${fgOf(PROJECT_COLORS.blue)}Ledge`);
      expect(f).not.toContain(`${fgOf(PROJECT_COLORS.green)}Website`);
    } finally { await tui.cleanup(); }
  });

  it('the settings: Thème cycles auto, sombre, clair, at once, and saves each', async () => {
    const tui = await startTui({ background: 'light' });
    try {
      await tui.press(',');
      await until(() => tui.frame().includes('RÉGLAGES'));
      expect(tui.frame()).toContain('Auto (fond clair)');
      await tui.press(DOWN); await tui.press(RIGHT);
      await until(() => tui.frame().includes(bgOf(PALETTES.dark.bar)));
      expect(tui.themes).toEqual(['dark']);
      await tui.press(RIGHT);
      await until(() => tui.frame().includes(bgOf(PALETTES.light.bar)));
      expect(tui.themes).toEqual(['dark', 'light']);
      expect(tui.frame()).toContain('Réglage enregistré.');
    } finally { await tui.cleanup(); }
  });

  it('the Markdown of an answer in the light palette: # in coral, inline code on its background, links in blue', async () => {
    const tui = await startTui({ theme: 'light' });
    try {
      await tui.press('/');
      tui.daemon.push({ type: 'chat.history', turns: [{ qid: 'h0', question: 'Qui ?', askedAt: now(-2), steps: [], answeredAt: now(-1), answer: '## Qui t’attend\n- `npm test` puis [la PR](https://x.io/1)' }] });
      await until(() => tui.frame().includes('Qui t’attend'));
      const f = tui.frame();
      expect(f).toContain(fgOf(PALETTES.light.coral));
      expect(f).toContain(bgOf(PALETTES.light.code));
      expect(f).toContain(fgOf(PALETTES.light.blue));
    } finally { await tui.cleanup(); }
  });

  /** What a light frame must not carry: a colour only the dark palette has (a hard-coded dark tone would show). */
  const darkOnly = () => {
    const lightValues = new Set<string>(Object.values(PALETTES.light));
    return Object.entries(PALETTES.dark).filter(([, v]) => !lightValues.has(v));
  };
  const noDark = (f: string) => {
    for (const [k, v] of darkOnly()) { expect(f, `dark ${k}`).not.toContain(fgOf(v)); expect(f, `dark ${k} bg`).not.toContain(bgOf(v)); }
  };

  it('the new screens render in the light theme: home, a rig room, the OMP pane', async () => {
    const omp = { ...mockupSessions()[1]!, id: 'omp1', name: 'Lyra', tool: 'omp' as const, backend: 'omp-rpc' as const, tmuxSession: null };
    const tui = await startTui({ theme: 'light', openrig: {}, sessions: [...mockupSessions(), omp] });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      expect(tui.frame()).toContain(fgOf(PALETTES.light.coral));
      noDark(tui.frame());
      await tui.press('2');
      await until(() => tui.frame().includes(' · RIG'));
      expect(tui.frame()).toContain('▣ ');
      noDark(tui.frame());
      tui.daemon.thread('omp1', [
        { kind: 'prompt', id: 'p', turn: 1, at: now(-3), text: 'Ajoute la gestion du 429' },
        { kind: 'reply', id: 'r', turn: 1, at: now(-1), text: 'Fait, avec un test.' }
      ] as ThreadItem[]);
      await tui.pick('Lyra');
      await until(() => tui.frame().includes('π FIL · OMP') && tui.frame().includes('Fait, avec un test.'));
      expect(tui.frame()).toContain(fgOf(PALETTES.light.omp));
      noDark(tui.frame());
    } finally { await tui.cleanup(); }
  });
});
