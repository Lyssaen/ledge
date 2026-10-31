import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ChatTurn, LedgeDecision, LedgeRule, LedgeThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';

const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const thread = () => within(home().getByRole('log', { name: 'Ledge’s thread' }));
const rail = () => within(home().getByRole('complementary', { name: 'Ledge rail' }));
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const sent = (d: MockDaemon, type: string) => d.received.filter(m => m.type === type);

const RULE: LedgeRule = { id: 'r1', text: 'Rebase avant la revue', category: 'git', since: '2026-10-26', from: 'user', appliedCount: 2, status: 'active' };
const D1: LedgeDecision = { id: 'd1', escalationId: 'qi-1', by: 'ledge', category: 'git', summary: 'Rebase sur main avant la revue.', answers: { q1: 'rebase' },
  rule: 'r1', why: 'branche partagée', from: 'build@factory', at: ago(5) };
const D2: LedgeDecision = { ...D1, id: 'd2', summary: 'Relancer les tests ciblés.', rule: 'r9', why: undefined, from: 'qa@factory', at: ago(3) };
const MINE: LedgeDecision = { ...D1, id: 'd3', by: 'user', summary: 'Garder le JSON.', at: ago(2) };
const OLD: LedgeDecision = { ...D1, id: 'd4', summary: 'Hier.', at: ago(60 * 30) };

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await closeDaemons(); });

async function openHome() {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [] });
  await home().findByRole('tab', { name: 'Conversation' });
  return env;
}
const push = (d: MockDaemon, items: LedgeThreadItem[]) => d.push({ type: 'ledge.thread.history', items });

describe('the brain in Ledge’s thread (lot 7)', () => {
  it('a decided line names the seat, the rule’s day and why; « Revisit » sends decision.revisit', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'rules', items: [RULE] });
    d.push({ type: 'decisions', items: [D2, D1] });
    push(d, [{ kind: 'decided', id: 't1', at: D1.at, decisionId: 'd1' }, { kind: 'decided', id: 't2', at: D2.at, decisionId: 'd2' }]);
    const line = (await thread().findByText('I settled for build: Rebase sur main avant la revue.')).closest('.lt-decided') as HTMLElement;
    expect(line).toHaveTextContent('Rule from 26/10');
    expect(line).toHaveTextContent('branche partagée');
    const gone = thread().getByText('I settled for qa: Relancer les tests ciblés.').closest('.lt-decided') as HTMLElement;
    expect(gone).toHaveTextContent('Rule r9');
    await user.click(within(line).getByRole('button', { name: 'Revisit' }));
    await waitFor(() => expect(sent(d, 'decision.revisit')).toEqual([{ type: 'decision.revisit', rid: expect.any(String), id: 'd1' }]));
  });

  it('« Settled today » lists today’s decisions by Ledge; « Revisit » there sends decision.revisit', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'decisions', items: [MINE, D2, D1, OLD] });
    const sec = within(await rail().findByRole('region', { name: 'Settled today · 2' }));
    expect(sec.getByText('Rebase sur main avant la revue.')).toBeVisible();
    expect(sec.getByText('Relancer les tests ciblés.')).toBeVisible();
    expect(sec.queryByText('Garder le JSON.')).toBeNull();
    expect(sec.queryByText('Hier.')).toBeNull();
    await user.click(sec.getAllByRole('button', { name: 'Revisit' })[0]!);
    await waitFor(() => expect(sent(d, 'decision.revisit')).toEqual([{ type: 'decision.revisit', rid: expect.any(String), id: 'd2' }]));
  });

  it('« Ledge est arrêté · Démarrer » is a stopped line with a Start button that sends brain.set', async () => {
    const { d, user } = await openHome();
    push(d, [{ kind: 'ledge', id: 'l1', at: ago(1), text: 'Ledge est arrêté · Démarrer' }]);
    expect(await thread().findByText('Ledge is stopped')).toBeVisible();
    expect(thread().queryByText('Ledge est arrêté · Démarrer')).toBeNull();
    await user.click(thread().getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(sent(d, 'brain.set')).toEqual([{ type: 'brain.set', rid: expect.any(String), enabled: true }]));
  });

  it('a rig the brain proposes shows « Launch this rig », which opens the launch window prefilled', async () => {
    const { d, user } = await openHome();
    const now = new Date().toISOString();
    const turn: ChatTurn = { qid: 'brain-1', question: '', askedAt: now, answeredAt: now, steps: [], answer: 'Je propose de lancer un rig hors projet (reprise) : reprendre après reboot',
      rigLaunch: { goal: 'reprendre après reboot', off: 'reprise', machine: 'local' } };
    d.push({ type: 'chat.history', turns: [turn] });
    push(d, [{ kind: 'ledge', id: 'l2', at: now, text: turn.answer!, qid: 'brain-1' }]);
    await user.click(await thread().findByRole('button', { name: 'Launch this rig' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'New rig' }));
    expect(dialog.getByDisplayValue('reprendre après reboot')).toBeVisible();
    expect(dialog.getByDisplayValue('reprise')).toBeVisible();
  });
});
