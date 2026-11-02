import { describe, it, expect } from 'vitest';
import type { ClientMessage, Escalation, Task } from '@ledge/protocol';
import { listedDecisions, openDecisions } from '../src/tui/model/overview.js';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: `Tâche ${id}`, giver: 'otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open',
  at: '2026-10-09T16:05:00.000Z', updatedAt: '2026-10-09T16:05:00.000Z', log: [], ...extra
});
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);

describe('tui: the decisions a session puts to the user', () => {
  it('openDecisions: the open ones given to Ledge, in their order; not an answered one, not a task Ledge gave', () => {
    const tasks = [
      task('t000001', { title: 'Fusionner feat/roles ?' }),
      task('t000002', { state: 'done', result: 'Oui' }),
      task('t000003', { giver: 'ledge', giverName: 'Ledge', owner: 'nova', ownerName: 'Nova' }),
      task('t000004', { state: 'taken' }),
      task('t000005', { state: 'refused' })
    ];
    expect(openDecisions(tasks).map(x => x.id)).toEqual(['t000001', 't000004']);
    expect(openDecisions([])).toEqual([]);
  });

  it('« À toi » lists the decision and counts it; D, the answer, its confirmation send exactly task.answer', async () => {
    const tui = await startTui();
    try {
      await tui.resize(160, 40);
      tui.daemon.push({ type: 'task.updated', task: task('t91b0d4', { title: 'Fusionner feat/roles ?', text: 'Options : oui / non\nLa CI est verte.' }) });
      await until(() => tui.frame().includes('Otto te demande : Fusionner feat/roles ?'));
      const f = tui.frame();
      expect(f).toContain('À TOI · 3');
      expect(f).toContain('3 t’attendent');
      // Joffrey's Home draws a decision on two lines, as an ask: who asks and what, then its options.
      expect(f).toMatch(/Otto te demande : Fusionner feat\/roles \?[^\n]*\n[^\n]*Options : oui \/ non/);
      expect(f).toMatch(/D +répondre à la décision/);

      await tui.press('D');
      await until(() => tui.frame().includes('RÉPONDRE À OTTO'));
      // ↵ on an empty field sends nothing.
      await tui.press('\r');
      expect(tui.frame()).not.toContain('UNE RÉPONSE NE SE REPREND PAS');
      await tui.press('Oui, fusionne');
      await tui.press('\r');
      await until(() => tui.frame().includes('UNE RÉPONSE NE SE REPREND PAS'));
      expect(tui.frame()).toContain('Oui, fusionne');
      expect(sent(tui.daemon.received, 'action.run')).toEqual([]);
      // n goes back to the field, the answer kept; a second ↵ asks again.
      await tui.press('n');
      await until(() => tui.frame().includes('RÉPONDRE À OTTO'));
      await tui.press('\r');
      await until(() => tui.frame().includes('UNE RÉPONSE NE SE REPREND PAS'));
      // Any other key (q) neither quits nor sends.
      await tui.press('q');
      expect(sent(tui.daemon.received, 'action.run')).toEqual([]);
      await tui.press('y');
      await until(() => sent(tui.daemon.received, 'action.run').length === 1);
      const run = sent(tui.daemon.received, 'action.run')[0]!;
      expect(run).toEqual({ type: 'action.run', rid: run.rid, action: 'task.answer', args: { task: 't91b0d4', answer: 'Oui, fusionne' }, confirmed: true });
      expect(sent(tui.daemon.received, 'task.cmd').filter(m => m.op === 'done')).toEqual([]);
      tui.daemon.push({ type: 'action.result', rid: run.rid, action: 'task.answer', reason: 'la décision est déjà répondue' });
      await until(() => tui.frame().includes('Réponse non envoyée : la décision est déjà répondue'));
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('esc in the field leaves it, nothing sent; D does nothing without a decision', async () => {
    const tui = await startTui();
    try {
      await tui.press('D');
      expect(tui.frame()).not.toContain('RÉPONDRE À');
      tui.daemon.push({ type: 'task.updated', task: task('t000001', { title: 'Quel port ?' }) });
      await until(() => tui.frame().includes('Otto te demande : Quel port ?'));
      await tui.press('D');
      await until(() => tui.frame().includes('RÉPONDRE À OTTO'));
      await tui.press('5173');
      await tui.press('\u001b');
      await until(() => !tui.frame().includes('RÉPONDRE À OTTO'));
      // Answered elsewhere: it leaves « À toi ».
      tui.daemon.push({ type: 'task.updated', task: task('t000001', { title: 'Quel port ?', state: 'done', result: '5173' }) });
      await until(() => !tui.frame().includes('Otto te demande'));
      expect(sent(tui.daemon.received, 'action.run')).toEqual([]);
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('a decision mirrored as its task- escalation is one card and one count; D still answers it through task.answer', async () => {
    const tui = await startTui();
    try {
      await tui.resize(160, 40);
      const t = task('t91b0d4', { title: 'Fusionner feat/roles ?', team: 'api' });
      tui.daemon.push({ type: 'task.updated', task: t });
      await until(() => tui.frame().includes('À TOI · 3'));
      const mirrored: Escalation = { id: 'task-t91b0d4', source: 'ask', machine: 'local', rigId: 'api', from: 'Otto', intent: 'decision', summary: 'Fusionner feat/roles ?', questions: [], createdAt: t.at, state: 'pending' };
      tui.daemon.push({ type: 'escalation.updated', escalation: mirrored });
      await until(() => tui.frame().includes('▣ local') && !tui.frame().includes('Otto te demande'));
      const f = tui.frame();
      // The escalation is the item: 3 before (2 + the decision), 3 after (2 + its escalation), never 4.
      expect(f).toContain('À TOI · 3');
      expect(f).toContain('3 t’attendent');
      expect(f.match(/Fusionner fea/g)).toHaveLength(1);
      await tui.press('D');
      await until(() => tui.frame().includes('RÉPONDRE À OTTO'));
      await tui.press('Oui');
      await tui.press('\r');
      await until(() => tui.frame().includes('UNE RÉPONSE NE SE REPREND PAS'));
      await tui.press('y');
      await until(() => sent(tui.daemon.received, 'action.run').length === 1);
      expect(sent(tui.daemon.received, 'action.run')[0]).toMatchObject({ action: 'task.answer', args: { task: 't91b0d4', answer: 'Oui' } });
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('listedDecisions: a decision with its escalation is left to the escalation, one without stays', () => {
    const a = task('t000001'); const b = task('t000002');
    const e = { id: 'task-t000001' } as Escalation;
    expect(listedDecisions([a, b], [e]).map(x => x.id)).toEqual(['t000002']);
    expect(listedDecisions([a, b], []).map(x => x.id)).toEqual(['t000001', 't000002']);
  });
});
