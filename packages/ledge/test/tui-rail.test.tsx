import { describe, it, expect } from 'vitest';
import type { ClientMessage, LedgeDecision, LedgeThreadItem } from '@ledge/protocol';
import { until } from './helpers.js';
import { mockupEscalations, startTui } from './tui-fixture.js';

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const RIGHT = '\u001b[C', LEFT = '\u001b[D', ESC = '\u001b';
/** The thread with the mockup's decision in it. */
const decisionInThread: LedgeThreadItem[] = [
  { kind: 'ledge', id: 'l1', at: ago(5), text: 'factory avance sur la reprise après reboot. Une décision t’attend :' },
  { kind: 'escalation', id: 'i-q117', at: ago(5), escalationId: 'q-117' }
];
const decision = (id: string, by: LedgeDecision['by'], summary: string, at = ago(10), escalationId = `q-${id}`): LedgeDecision =>
  ({ id, escalationId, by, category: 'git', summary, answers: {}, at });
/** What Ledge settled today, as the mockup's rail lists it; one the user settled and one of yesterday are not its own today. */
const today = (): LedgeDecision[] => [
  decision('d1', 'ledge', 'merge, pas de rebase'), decision('d2', 'ledge', 'tests ciblés'), decision('d3', 'ledge', 'starter relancé'),
  decision('d4', 'user', 'SQLite'), decision('d5', 'ledge', 'vieille affaire', new Date(Date.now() - 2 * 86_400_000).toISOString())
];

describe('ledge tui: the rail and the tabs', () => {
  it('the rail shows Rigs, Tranché aujourd’hui and Mandat, never À toi', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'decisions', items: today() });
      await until(() => tui.frame().includes('TRANCHÉ AUJOURD’HUI · 3'));
      const f = tui.frame();
      expect(f).toContain('RIGS · 2');
      expect(f).toMatch(/▣ factory +4\/6 ████████░░░░/);
      expect(f).toMatch(/▣ starter +1\/2 ██████░░░░░░/);
      expect(f).toMatch(/◈ noyau +au repos/);
      expect(f).toContain('2 · la pièce du rig');
      expect(f).toContain('✓ merge, pas de rebase');
      expect(f).not.toContain('vieille affaire');
      expect(f).toContain('u revenir dessus');
      expect(f).toContain('MANDAT');
      expect(f).toContain('Ledge tranche seul :');
      expect(f).toContain('git et branches');
      expect(f).toContain('Te reviennent toujours :');
      expect(f).toContain('design, architecture,');
      expect(f).toContain('m le mandat et ses souvenirs');
      expect(f).toContain('Résumer la journée');
      expect(f).toContain('LEDGE · CONVERSATION · RIGS · MANDAT');
      // « À toi » is the left column's, once.
      expect(f.split('À TOI').length - 1).toBe(1);
    } finally { await tui.cleanup(); }
  });

  it('Tranché aujourd’hui is hidden without decisions', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('Ledge tranche seul :'));
      expect(tui.frame()).not.toContain('TRANCHÉ AUJOURD’HUI');
      // Only the user's and yesterday's: none of Ledge's today.
      tui.daemon.push({ type: 'decisions', items: today().slice(3) });
      await new Promise(r => setTimeout(r, 100));
      expect(tui.frame()).not.toContain('TRANCHÉ AUJOURD’HUI');
      expect(tui.frame()).toContain('RIGS · 2');
    } finally { await tui.cleanup(); }
  });

  it('R sends the day summary', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('Résumer la journée'));
      await tui.press('R');
      await until(() => sent(tui.daemon.received, 'ledge.say').length === 1);
      expect(sent(tui.daemon.received, 'ledge.say')[0]!.text).toBe('Résume ma journée : ce que les rigs ont fait, ce que j\'ai tranché, ce qui m\'attend.');
    } finally { await tui.cleanup(); }
  });

  it('u in the rail revisits the latest decision Ledge took today', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      tui.daemon.push({ type: 'decisions', items: today() });
      await until(() => tui.frame().includes('TRANCHÉ AUJOURD’HUI · 3'));
      await tui.press('u');
      await until(() => sent(tui.daemon.received, 'decision.revisit').length === 1);
      expect(sent(tui.daemon.received, 'decision.revisit')[0]).toMatchObject({ id: 'd3' });
    } finally { await tui.cleanup(); }
  });

  it('← → switch Conversation, Rigs and Mandat', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('ÉCRIRE À LEDGE'));
      // In the left column, ← → are not the tabs'.
      await tui.press(RIGHT);
      expect(tui.frame()).toContain('ÉCRIRE À LEDGE');
      await tui.press('\r');
      await until(() => tui.frame().includes('alt+↵'));
      // Text in the field: ← → move its cursor, the tab stays.
      await tui.press('ab');
      await tui.press(RIGHT);
      expect(tui.frame()).toContain('ÉCRIRE À LEDGE');
      await tui.press('\u0015'); // ctrl+u: the field emptied
      await tui.press(RIGHT);
      await until(() => /factory +4\/6 au travail +dans Ledge · Local/.test(tui.frame()));
      expect(tui.frame()).not.toContain('ÉCRIRE À LEDGE');
      await tui.press(RIGHT);
      await until(() => tui.frame().includes('Le mandat arrive avec le cerveau de Ledge.'));
      tui.daemon.push({ type: 'mandate', text: '# Mandat\n\nLes merges sans conflit, **seul**.', path: '/home/u/.ledge/mandate.md' });
      tui.daemon.push({ type: 'rules', items: [
        { id: 'r1', text: 'Jamais de force-push', category: 'git', since: ago(60), from: 'd1', appliedCount: 2, status: 'active' },
        { id: 'r2', text: 'Tests ciblés après un merge', category: 'tests', since: ago(30), from: 'd2', appliedCount: 0, status: 'proposed' }
      ] });
      await until(() => tui.frame().includes('Jamais de force-push'));
      expect(tui.frame()).toContain('Les merges sans conflit, seul.');
      expect(tui.frame()).toMatch(/Tests ciblés après un merge.*à valider/);
      expect(tui.frame()).not.toContain('Le mandat arrive');
      await tui.press(LEFT);
      await until(() => /factory +4\/6 au travail +dans Ledge · Local/.test(tui.frame()));
      // ↵ on a rig chooses it: its room.
      await tui.press('\r');
      await until(() => tui.frame().includes('▣ FACTORY'));
    } finally { await tui.cleanup(); }
  });

  it('m opens the Mandat tab', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(160, 46);
      await until(() => tui.frame().includes('m le mandat et ses souvenirs'));
      await tui.press('m');
      await until(() => tui.frame().includes('Le mandat arrive avec le cerveau de Ledge.'));
    } finally { await tui.cleanup(); }
  });

  it('at 112 columns the rail folds into one line and the decision can still be answered', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(112, 40);
      tui.daemon.push({ type: 'decisions', items: today() });
      tui.daemon.push({ type: 'ledge.thread.history', items: decisionInThread });
      await until(() => tui.frame().includes(' 1 · SQLite 1 '));
      const f = tui.frame();
      // 68 columns for the centre: what does not fit is cut, « ] détail » stays.
      expect(f).toMatch(/▣ factory 4\/6 +▣ starter 1\/2 +◈ noyau au repos .*\] détail/);
      expect(f).not.toContain('Ledge tranche seul :');
      // ] opens the rail over the conversation, esc closes it; the decision stays in view.
      await tui.press(']');
      await until(() => tui.frame().includes('Ledge tranche seul :'));
      expect(tui.frame()).toContain(' 1 · SQLite 1 ');
      await tui.press(ESC);
      await until(() => !tui.frame().includes('Ledge tranche seul :'));
      expect(tui.frame()).toContain('LEDGE · CONVERSATION');
      await tui.press('1');
      await until(() => sent(tui.daemon.received, 'escalation.answer').length === 1);
      expect(sent(tui.daemon.received, 'escalation.answer')[0]).toMatchObject({ id: 'q-117', answers: { q1: 'sqlite' } });
      // Wider, the whole line.
      await tui.resize(130, 40);
      await until(() => /▣ factory 4\/6 +▣ starter 1\/2 +◈ noyau au repos +✓ 3 tranchées +\] détail/.test(tui.frame()));
    } finally { await tui.cleanup(); }
  });

  it('at 90 columns ↵ on Ledge opens the conversation and the decision is answerable', async () => {
    const tui = await startTui({ openrig: {} });
    try {
      await tui.resize(90, 40);
      tui.daemon.push({ type: 'ledge.thread.history', items: decisionInThread });
      await until(() => tui.frame().includes('Une décision t’attend · factory'));
      expect(tui.frame()).not.toContain(' 1 · SQLite 1 ');
      await tui.press('\r');
      await until(() => tui.frame().includes(' 1 · SQLite 1 '));
      // The conversation has the whole screen, the left column gone.
      expect(tui.frame()).not.toContain('PROJETS · SESSIONS SEULES');
      await tui.press('1');
      await until(() => sent(tui.daemon.received, 'escalation.answer').length === 1);
      expect(sent(tui.daemon.received, 'escalation.answer')[0]).toMatchObject({ id: 'q-117', answers: { q1: 'sqlite' } });
      // / then writes to Ledge.
      await tui.press('/');
      await until(() => tui.frame().includes('alt+↵'));
    } finally { await tui.cleanup(); }
  });

  it('at 60 × 16 the left column fits, its rigs in view', async () => {
    const tui = await startTui({ openrig: { escalations: mockupEscalations() } });
    try {
      await tui.resize(60, 16);
      await until(() => tui.frame().includes('▣ factory'));
      const lines = tui.frame().split('\n');
      expect(lines.length).toBeLessThanOrEqual(16);
      // The rigs box is whole: its title, its rig, its bottom border on its own line above the key bar.
      const rigs = lines.findIndex(l => l.includes('╭─ RIGS'));
      expect(rigs).toBeGreaterThan(0);
      expect(lines[rigs + 1]).toContain('▣ factory');
      expect(lines[rigs + 2]).toMatch(/^╰─+╯$/);
      expect(lines[rigs + 3]).toMatch(/^ +j k/);
    } finally { await tui.cleanup(); }
  });
});
