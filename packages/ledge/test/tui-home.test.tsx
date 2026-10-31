import { describe, it, expect } from 'vitest';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';

describe('ledge tui: home', () => {
  it('home opens on Ledge and 1 2 3 move between Ledge, the rig and the session', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('RIGS') && tui.frame().includes('factory'));
      const f = tui.frame();
      expect(f).toContain('LEDGE');
      expect(f).toContain('Une décision t’attend · factory');
      expect(f).toContain('À TOI · 3');
      expect(f).toContain('PROJETS · SESSIONS SEULES');
      expect(f).toMatch(/▣ factory 4\/6 au travail · dans Ledge/);
      expect(f).toMatch(/orch-lead .*Attend Ledge/);
      expect(f).toContain('review-b, design · disponibles');
      expect(f).toContain('◈ Noyau OpenRig au repos · operator, queue');
      expect(f).toContain('LEDGE · CONVERSATION');
      // The status bar counts the rigs, their agents, the standalone sessions and the machines, then who waits.
      expect(f).toContain('2 rigs · 8 agents · 4 sessions seules · 1 machine · 3 t’attendent');
      await tui.press('2');
      await until(() => tui.frame().includes('▣ FACTORY'));
      await tui.press('1');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press('j');
      await tui.press('3');
      // The escalation is selected: 3 has no session to open.
      expect(tui.frame()).toContain('À TOI · 3');
      await tui.pick('Otto');
      await tui.press('3');
      await until(() => tui.frame().includes('Otto veut exécuter'));
    } finally { await tui.cleanup(); }
  });

  it('a paired seat opens its session with ↵; the kernel row is reachable', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('factory'));
      await tui.pick('build');
      await tui.press('\r');
      await until(() => tui.frame().includes('ÉCRIRE'));
    } finally { await tui.cleanup(); }
  });

  it('without OpenRig, Rigs says it is not installed', async () => {
    const tui = await startTui();
    try {
      // 44 columns wide at 100: the line goes on two.
      await until(() => tui.frame().includes('OpenRig n’est pas installé'));
      expect(tui.frame()).toContain('+ pour lancer un rig');
      expect(tui.frame()).toContain('0 rig · 0 agent · 4 sessions seules');
    } finally { await tui.cleanup(); }
  });

  it('↵ on Ledge opens the field; tab goes to the first one waiting', async () => {
    const tui = await startTui();
    try {
      await tui.press('\t');
      await until(() => tui.frame().includes('OTTO · CÂBLER LA LISTE DES SESSIONS'));
      await tui.press('1');
      await until(() => tui.frame().includes('LEDGE · CONVERSATION'));
      await tui.press('\r');
      await until(() => tui.frame().includes('QUESTION'));
    } finally { await tui.cleanup(); }
  });

  it('a `ledge ask` the daemon mirrors as an escalation is listed and counted once', async () => {
    const at = new Date(Date.now() - 120_000).toISOString();
    const tui = await startTui({ openrig: { rigs: [], escalations: [{ id: 'ask-a1b2c3d', source: 'ask', machine: 'local', from: 'Nova', intent: 'decision', summary: 'Quelle base ?', questions: [], createdAt: at, state: 'pending' }] } });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'asks', asks: [{ id: 'a1b2c3d', from: 'nova', fromName: 'Nova', question: 'Quelle base ?', options: 'sqlite, postgres', at, state: 'open' }] });
      await until(() => tui.frame().includes('Quelle base ?'));
      await new Promise(r => setTimeout(r, 100));
      const f = tui.frame();
      expect(f).toContain('À TOI · 3');
      expect(f).toContain('3 t’attendent');
      expect(f).not.toContain('? Nova : Quelle base ?');
      expect(f).not.toContain('ledge decide');
      expect(f.split('Quelle base ?').length - 1).toBe(1);
      expect(f).toMatch(/\? Nova +● Local +Quelle base \?/);
    } finally { await tui.cleanup(); }
  });
});
