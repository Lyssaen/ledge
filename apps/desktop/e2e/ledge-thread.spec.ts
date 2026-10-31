import type { Page } from '@playwright/test';
import type { ClientMessage, Escalation, Exchange, LedgeThreadItem, OpenRigStatus, Rig, RigSeat } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects, openAtelier } from './daemon';

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Of<T> => m.type === type);

const AT = new Date(Date.now() - 4 * 60_000).toISOString();
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.3.0' };
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const FACTORY: Rig = { id: 'r-factory', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('build'), seat('orch-lead', { state: 'idle' })] };
const TITLE = 'Sessions : passer du fichier JSON à SQLite ?';
const ESC: Escalation = { id: 'q1', source: 'rig', machine: 'local', rigId: 'r-factory', from: 'orch-lead@factory', intent: 'decision', summary: TITLE, createdAt: AT, state: 'pending', category: 'code',
  questions: [{ id: 'storage', question: TITLE, options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Garder le JSON' }] }] };
const ESC_ITEM: LedgeThreadItem = { kind: 'escalation', id: 't-q1', at: AT, escalationId: 'q1' };
const otto = session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });

const thread = (page: Page) => page.getByRole('log', { name: 'Ledge’s thread' });
const card = (page: Page) => thread(page).locator('[data-escalation-card="q1"]');
const todo = (page: Page) => page.locator('aside.sidebar [data-escalation="q1"]');
const field = (page: Page) => page.getByPlaceholder('Write to Ledge… (@build for a rig\'s agent)');

async function boot(page: Page) {
  await page.goto('/');
  await page.locator('section.ledge-home').waitFor();
  await expect(page.getByRole('tabpanel', { name: 'Conversation' })).toBeVisible();
}

test('answering a decision in the thread', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], escalations: [ESC], thread: [ESC_ITEM] });
  await boot(page);
  await expect(card(page)).toContainText(TITLE);
  await expect(todo(page)).toHaveCount(1);
  await card(page).getByRole('button', { name: 'SQLite' }).click();
  await expect(card(page)).toContainText('Answered by you: SQLite');
  expect(sent(daemon.received, 'escalation.answer')).toEqual([expect.objectContaining({ id: 'q1', answers: { storage: 'sqlite' }, by: 'user' })]);
  await expect(todo(page)).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'SQLite' })).toHaveCount(0);
});

test('a second device answering first shows « Already answered »', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], escalations: [ESC], thread: [ESC_ITEM], answerDelayMs: 600 });
  await boot(page);
  await card(page).getByRole('button', { name: 'SQLite' }).click();
  // The other device wins before this device's answer comes back: Ledge settled it, then the daemon refuses ours.
  daemon.pushEscalation({ ...ESC, state: 'answered', answer: { by: 'ledge', answers: { storage: 'json' }, at: new Date().toISOString() } });
  await expect(card(page)).toContainText('Already answered');
  await expect(card(page)).toContainText('Settled by Ledge: Garder le JSON');
  await expect(card(page).getByRole('button', { name: 'SQLite' })).toHaveCount(0);
  await expect(todo(page)).toHaveCount(0);
});

test('exchanges fold into one group', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY] });
  await boot(page);
  const base = Date.now() - 8 * 60_000;
  const xs: Exchange[] = ['task', 'message', 'handoff'].map((kind, i) => ({ id: `x${i}`, machine: 'local', rigId: 'r-factory', from: 'orch-lead@factory', to: 'build@factory', kind: kind as Exchange['kind'],
    text: `Exchange number ${i + 1}`, at: new Date(base + i * 60_000).toISOString() }));
  for (const x of xs) daemon.pushExchange(x);
  daemon.threadItem({ kind: 'exchanges', id: 'g1', at: xs[2]!.at, machine: 'local', rigId: 'r-factory', from: xs[0]!.at, to: xs[2]!.at, exchangeIds: xs.map(x => x.id) });
  const group = thread(page).locator('section.lt-group');
  await expect(group).toContainText('factory · 3 exchanges between agents');
  await expect(group).toContainText('Exchange number 3');
  await group.getByRole('button', { name: /^Fold/ }).click();
  await expect(group).toContainText('factory · 3 exchanges between agents');
  await expect(group).not.toContainText('Exchange number 3');
  await group.getByRole('button', { name: /^See/ }).click();
  await expect(group).toContainText('Exchange number 3');
});

test('asking Ledge streams the bubble', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], chat: { steps: [{ kind: 'sessions' }], text: 'Nobody needs you right now; **factory** is working.' } });
  await boot(page);
  await field(page).fill('Who needs me?');
  await field(page).press('Enter');
  expect(sent(daemon.received, 'ledge.say')).toEqual([expect.objectContaining({ text: 'Who needs me?' })]);
  expect(sent(daemon.received, 'chat.ask')).toHaveLength(0);
  const mine = thread(page).locator('.lt-bubble[data-author="user"]').filter({ hasText: 'Who needs me?' }).first();
  await expect(mine).toBeVisible();
  // The user's bubble sits on the right of the thread, Ledge's answer on the left.
  const log = (await thread(page).boundingBox())!;
  const you = (await mine.boundingBox())!;
  expect(you.x + you.width / 2).toBeGreaterThan(log.x + log.width / 2);
  const answer = thread(page).getByText('Nobody needs you right now');
  await expect(answer).toBeVisible();
  expect((await answer.boundingBox())!.x).toBeLessThan(you.x);
});

test('@build writes to the seat', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY] });
  await boot(page);
  await field(page).fill('@build@factory run the tests');
  await field(page).press('Enter');
  expect(sent(daemon.received, 'ledge.say')).toEqual([expect.objectContaining({ text: '@build@factory run the tests' })]);
  await expect(thread(page)).toContainText('run the tests');
  await expect(thread(page)).toContainText('@build@factory');
  expect(sent(daemon.received, 'chat.ask')).toHaveLength(0);
});
