import type { Escalation, Exchange, OpenRigStatus, Rig } from '@ledge/protocol';
import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openChat, wake } from './scenarios';

/* The open notch is Ledge's mixed feed (lot 4, spec §8.5, `nn-open.png`): the waiting decision pinned on top, the feed, « Only Ledge »,
   and the composer that writes to Ledge. The closed notch says the last exchange for 5 s, then goes back to calm. */
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: ['build', 'review-a', 'orch-lead'].map(n => ({ ref: `${n}@factory`, address: `@${n}`, name: n, runtime: 'claude-code', state: 'working' as const })) };
const DECISION: Escalation = { id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'orch-lead@factory', intent: 'decision',
  summary: 'Sessions: JSON or SQLite?', advice: 'SQLite.', category: 'architecture', createdAt: new Date(Date.now() - 4 * 60_000).toISOString(), state: 'pending',
  questions: [{ id: 'q1', question: 'JSON or SQLite?', options: [{ id: 'sqlite', label: 'SQLite', recommended: true }, { id: 'json', label: 'Keep JSON' }] }] };
const exchange = (id: string, at: string, extra: Partial<Exchange> = {}): Exchange =>
  ({ id, machine: 'local', rigId: 'r1', from: 'build@factory', to: 'review-a@factory', kind: 'message', text: 'Candidate ready on feat/rigs.', at, ...extra });

test('open notch answers the pinned decision', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { state: 'idle' })], { openrig: RUNNING, rigs: [FACTORY], escalations: [DECISION], answerDelayMs: 300 });
  await ready(page, 1);
  const line = layer(page, 'handle').locator('[data-ledge-line]');
  await expect(line).toHaveAttribute('data-kind', 'forYou');
  await openChat(page);
  const feed = layer(page, 'chat');
  await expect(feed).toContainText('Orchestrates 1 rig · 3 agents · settles within its mandate');
  const card = feed.locator('.lt-card');
  await expect(card).toContainText('Sessions: JSON or SQLite?');
  await expect(card).toContainText('My view: SQLite.');
  await card.getByRole('button', { name: 'SQLite' }).click();
  expect(await received(d.received, 'escalation.answer')).toEqual({ type: 'escalation.answer', rid: expect.any(String), id: 'qi-1', answers: { q1: 'sqlite' }, by: 'user' });
  // Answered, the decision leaves the top of the feed; closed, the notch is calm again.
  await expect(card).toHaveCount(0);
  await feed.getByRole('button', { name: 'Close' }).click();
  await expectMode(page, 'handle');
  await expect(line).toHaveCount(0);
});

test('closed notch shows the exchange line then calm', async ({ page }) => {
  await page.clock.install();
  const d = await fakeDaemon(page, [session('a', { state: 'idle' })], { openrig: RUNNING, rigs: [FACTORY] });
  await ready(page, 1);
  await wake(page);
  const handle = layer(page, 'handle');
  d.pushExchange(exchange('x1', new Date(await page.evaluate(() => Date.now())).toISOString()));
  await expect(handle.locator('[data-ledge-line]')).toHaveAttribute('data-kind', 'exchange');
  await expect(handle).toContainText('build → review-a');
  await page.clock.fastForward(5_100);
  await expect(handle).not.toContainText('build → review-a');
  await expect(handle.locator('[data-ledge-line]')).toHaveCount(0);
});

test('the feed mixes exchanges and Ledge; « Only Ledge » hides the exchanges; the composer writes to Ledge', async ({ page }) => {
  const now = Date.now(), ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const d = await fakeDaemon(page, [session('a', { state: 'idle' })], {
    openrig: RUNNING, rigs: [FACTORY], chat: { text: 'It was near 82 % of context.' },
    exchanges: { r1: [exchange('x1', ago(6), { from: 'orch-lead@factory', to: 'build@factory', kind: 'task', text: 'Check the restore.' }), exchange('x2', ago(5))] },
    thread: [{ kind: 'exchanges', id: 'g1', at: ago(6), machine: 'local', rigId: 'r1', from: ago(6), to: ago(5), exchangeIds: ['x1', 'x2'] }]
  });
  await ready(page, 1);
  await openChat(page);
  const feed = layer(page, 'chat');
  const lines = feed.locator('[data-feed-line]');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText('orch-lead → build · factory · task');
  const field = feed.getByRole('textbox', { name: 'Ask Ledge' });
  await expect(field).toHaveAttribute('placeholder', 'Write to Ledge… (@build for an agent)');
  await field.fill('Why was review-b restarted?');
  await page.keyboard.press('Enter');
  expect(await received(d.received, 'ledge.say')).toEqual({ type: 'ledge.say', rid: expect.any(String), text: 'Why was review-b restarted?' });
  expect(d.received.some(m => m.type === 'chat.ask')).toBe(false);
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(2)).toContainText('You → Ledge');
  await expect(lines.nth(3)).toContainText('Ledge → you');
  await expect(lines.nth(3)).toContainText('It was near 82 % of context.');
  await feed.getByRole('button', { name: 'Only Ledge' }).click();
  await expect(lines).toHaveCount(2);
  await expect(feed.getByRole('button', { name: 'Only Ledge' })).toHaveAttribute('aria-pressed', 'true');
});
