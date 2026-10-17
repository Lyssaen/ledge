import { afterEach, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ToolItem } from '@ledge/protocol';
import { fakeSession, T0 } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, declarations, listSessions, ottoThread } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const md = '# Plan : version 0.6.0\n\nPréparer la release.\n\n1. **Changelog** — résumer\n2. Monter les versions\n3. Construire\n4. Publier';
const side = () => within(screen.getByRole('complementary', { name: 'Reading pane' }));
const card = (key: string) => within(document.querySelector<HTMLElement>(`[data-plan-card="${key}"]`)!);
/** The open plan tab's status line: its status, and the keys to answer when it is the request. */
const status = () => document.querySelector('.plan-doc-status')?.textContent;
const HINT = 'Awaiting your approvalAnswer below the thread: Y approve · N keep planning';
const exit = (id: string, status: ToolItem['status']): ToolItem => ({ kind: 'tool', id, at: T0, turn: 3, tool: 'ExitPlanMode', label: '# Plan : version 0.6.0', input: JSON.stringify({ plan: md }, null, 2), status, files: [] });

it('the plan card in the thread, read beside; the pinned plan sums it up and approves with Y', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [{ kind: 'prompt', id: 'prompt-1', at: new Date().toISOString(), turn: 1, text: 'Prépare la 0.6' }, exit('p1', 'running')]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  const plan = within(await screen.findByText('Proposed plan').then(e => e.closest<HTMLElement>('.plan-card')!));
  expect(plan.getByText('Awaiting your approval')).toBeVisible();
  expect([...document.querySelectorAll('.plan-steps li')].map(e => e.textContent)).toEqual(['Changelog', 'Monter les versions', 'Construire', '… and 1 more step']);
  const pinned = within(screen.getByRole('region', { name: 'Plan to approve' }));
  expect(pinned.getByText('Pia proposes a plan · Plan : version 0.6.0')).toBeVisible();
  expect(pinned.getByText(/^4 steps: Changelog · Monter les versions · Construire · Publier/)).toBeVisible();
  await user.click(pinned.getByRole('button', { name: 'Read the plan' }));
  const side = within(screen.getByRole('complementary', { name: 'Reading pane' }));
  expect(side.getByText('Plan proposed by Pia')).toBeVisible();
  expect(plan.getByRole('button', { name: /Open beside/ })).toBeVisible();
  await user.keyboard('y');
  await waitFor(() => expect(d.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'accept', expect: { kind: 'plan', text: '# Plan : version 0.6.0' } }]));
});
it('keep planning with a note: the old card is revised, the new one and the pinned request follow it', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [exit('p1', 'running')]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await user.type(await screen.findByRole('textbox', { name: 'Reply to the agent' }), 'Sans la publication{Enter}');
  await waitFor(() => expect(d.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'pia', decision: 'deny', note: 'Sans la publication', expect: { kind: 'plan', text: '# Plan : version 0.6.0' } }]));
  const v2 = md.replace('# Plan : version 0.6.0', '# Plan : version 0.6.0 (révisé)').replace('\n4. Publier', '');
  d.threadItem('pia', { ...exit('p1', 'failed') });
  d.threadItem('pia', { ...exit('p2', 'running'), input: JSON.stringify({ plan: v2 }) });
  d.upsert({ ...pia, pending: { kind: 'plan', text: '# Plan : version 0.6.0 (révisé)', body: v2, source: 'hook' }, lastActivityAt: new Date().toISOString() });
  await waitFor(() => expect([...document.querySelectorAll('.plan-card')].map(c => c.querySelector('.plan-status')!.textContent)).toEqual(['Revised afterwards', 'Awaiting your approval']));
  expect(screen.getByRole('region', { name: 'Plan to approve' })).toHaveTextContent('Pia proposes a plan · Plan : version 0.6.0 (révisé)');
  await user.click(within(screen.getByRole('region', { name: 'Plan to approve' })).getByRole('button', { name: 'Read the plan' }));
  expect(within(screen.getByRole('complementary', { name: 'Reading pane' })).getByText('Plan : version 0.6.0 (révisé)', { selector: 'strong' })).toBeVisible();
  // The pinned request opened the waiting card's plan, not the request's own.
  expect(card('p2').getByRole('button', { name: /Open beside/ })).toBeVisible();
  expect(card('p1').getByRole('button', { name: /Read the plan/ })).toBeVisible();
  expect(side().queryAllByRole('tab')).toHaveLength(0);
});
it('a plan still running when the agent proposes another is revised: its tab says so, without the keys', async () => {
  const v2 = md.replace('# Plan : version 0.6.0', '# Plan : version 0.6.0 (révisé)');
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0 (révisé)', body: v2, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [exit('p1', 'running'), { ...exit('p2', 'running'), input: JSON.stringify({ plan: v2 }) }]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await waitFor(() => expect([...document.querySelectorAll('.plan-card')].map(c => c.querySelector('.plan-status')!.textContent)).toEqual(['Revised afterwards', 'Awaiting your approval']));
  await user.click(card('p1').getByRole('button', { name: /Read the plan/ }));
  expect(status()).toBe('Revised afterwards');
  await user.click(card('p2').getByRole('button', { name: /Read the plan/ }));
  expect(status()).toBe(HINT);
});
it('the keys are not offered where the plan cannot be answered: read only, offline, on a subagent page', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', source: 'hook_only', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'hook' } });
  const env = await boot({ sessions: [...listSessions(), pia], list: true });
  env.d.thread('pia', [exit('p1', 'running')]);
  await env.user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await screen.findByText('Proposed plan');
  await env.user.click(card('p1').getByRole('button', { name: /Read the plan/ }));
  expect(status()).toBe('Awaiting your approval');
  cleanup(); await closeDaemons();

  // Offline: the keys go with the connection.
  const online = { ...pia, source: 'launcher' as const };
  const { d, user } = await boot({ sessions: [...listSessions(), online], list: true });
  d.thread('pia', [exit('p1', 'running')]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await screen.findByText('Proposed plan');
  await user.click(card('p1').getByRole('button', { name: /Read the plan/ }));
  expect(status()).toBe(HINT);
  d.upsert({ ...online, offline: true });
  await waitFor(() => expect(status()).toBe('Awaiting your approval'));
  cleanup(); await closeDaemons();

  // A subagent's page: its parent answers for it.
  const otto = { ...listSessions()[0]!, pending: { kind: 'plan' as const, text: '# Plan : version 0.6.0', body: md, source: 'hook' as const, helperId: 'h1' } };
  const sub = await boot({ sessions: [otto, ...listSessions().slice(1)], list: true });
  sub.d.thread('otto', [...ottoThread(), { ...exit('hp', 'running'), turn: 1, helperId: 'h1' }]);
  await sub.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await sub.user.click(await screen.findByRole('button', { name: 'Open Explore: Lire le code' }));
  await screen.findByText('Proposed plan');
  await sub.user.click(card('hp').getByRole('button', { name: /Read the plan/ }));
  expect(side().getByText('Plan proposed by Explore')).toBeVisible();
  expect(status()).toBe('Awaiting your approval');
});
it('a request tab opened before its action arrived keeps its keys', async () => {
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [{ kind: 'prompt', id: 'prompt-1', at: new Date().toISOString(), turn: 1, text: 'Prépare la 0.6' }]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await screen.findByText('Prépare la 0.6');
  await user.click(within(screen.getByRole('region', { name: 'Plan to approve' })).getByRole('button', { name: 'Read the plan' }));
  expect(status()).toBe(HINT);
  d.threadItem('pia', exit('p1', 'running'));
  await screen.findByText('Proposed plan');
  expect(status()).toBe(HINT);
});
it('a decided plan is a chip', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  d.thread('otto', [...ottoThread(), { kind: 'permission', id: 'perm-plan', at: new Date().toISOString(), turn: 2, tool: 'ExitPlanMode', text: '# Plan : version 0.6.0', decision: 'always' }]);
  await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  expect(document.querySelector('.decision-chip.plan.always')).toHaveTextContent('✓Plan approved · auto modePlan : version 0.6.0');
  // Answered in the terminal, its fate is not known: no success colour.
  expect(declarations('session.css', '.decision-chip.plan.unknown .chip-mark')).toBe('color:var(--muted-foreground)');
});
it('a plan without its action (Codex) is read from the request; once answered, its tab keeps the plan, its fate untold', async () => {
  const cora = fakeSession('cora', { name: 'Cora', tool: 'codex', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'pane' } });
  const { d, user } = await boot({ sessions: [...listSessions(), cora], list: true });
  d.thread('cora', [{ kind: 'prompt', id: 'prompt-1', at: new Date().toISOString(), turn: 1, text: 'Prépare la 0.6' }]);
  await user.click(screen.getByRole('listitem', { name: /^Cora,/ }));
  await screen.findByText('Prépare la 0.6');
  expect(document.querySelector('.plan-card')).toBeNull();
  await user.click(within(screen.getByRole('region', { name: 'Plan to approve' })).getByRole('button', { name: 'Read the plan' }));
  const side = within(screen.getByRole('complementary', { name: 'Reading pane' }));
  expect(side.getByText('Plan : version 0.6.0', { selector: 'strong' })).toBeVisible();
  expect(side.getByText('Plan proposed by Cora')).toBeVisible();
  expect(document.querySelector('.plan-doc-status')).toHaveTextContent('Awaiting your approvalAnswer below the thread: Y approve · N keep planning');
  d.upsert({ ...cora, state: 'working', pending: undefined, lastActivityAt: new Date().toISOString() });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Plan to approve' })).toBeNull());
  expect(side.getByText('Plan : version 0.6.0', { selector: 'strong' })).toBeVisible();
  expect(document.querySelector('.plan-doc-status')).toBeNull();
});
it('a plan whose steps are headings: counted, no step shown twice as the intro; a plan without steps says no count', async () => {
  const headed = '# Plan : version 0.7\n\n### 1. **Lire** le code\n- src/a.ts\n### 2) Écrire les tests\n### 3. Livrer';
  const prose = '# Plan : nettoyage\n\nRanger le dépôt sans rien casser.';
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : nettoyage', body: prose, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [{ ...exit('p1', 'success'), input: JSON.stringify({ plan: headed }) }, { ...exit('p2', 'running'), input: JSON.stringify({ plan: prose }) }]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await screen.findAllByText('Proposed plan');
  expect([...document.querySelectorAll('[data-plan-card="p1"] .plan-steps li')].map(e => e.textContent)).toEqual(['Lire le code', 'Écrire les tests', 'Livrer']);
  expect(document.querySelector('[data-plan-card="p1"] .plan-intro')).toBeNull();
  expect(card('p1').getByText('3 steps')).toBeVisible();
  expect(document.querySelector('[data-plan-card="p2"] .plan-intro')).toHaveTextContent('Ranger le dépôt sans rien casser.');
  expect(document.querySelector('[data-plan-card="p2"] .plan-card-foot')).not.toHaveTextContent(/steps?/);
  expect(screen.getByRole('region', { name: 'Plan to approve' })).not.toHaveTextContent(/steps?:/);
});
it('the pinned request reads its own plan: a stale waiting card with another plan is not it', async () => {
  const v2 = '# Plan : autre chose\n\nUn autre plan.\n\n1. Faire\n2. Vérifier';
  const pia = fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: '# Plan : autre chose', body: v2, source: 'hook' } });
  const { d, user } = await boot({ sessions: [...listSessions(), pia], list: true });
  d.thread('pia', [exit('p0', 'running')]);
  await user.click(screen.getByRole('listitem', { name: /^Pia,/ }));
  await screen.findByText('Proposed plan');
  await user.click(within(screen.getByRole('region', { name: 'Plan to approve' })).getByRole('button', { name: 'Read the plan' }));
  expect(side().getByText('Plan : autre chose', { selector: 'strong' })).toBeVisible();
  expect(status()).toBe(HINT);
  expect(card('p0').getByRole('button', { name: /Read the plan/ })).toBeVisible();
  await user.click(card('p0').getByRole('button', { name: /Read the plan/ }));
  expect(status()).not.toContain('Answer below the thread');
});
