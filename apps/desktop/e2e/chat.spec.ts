import { test, expect } from './fixtures';
import { fakeDaemon, fakeRemote, ROUTING, session } from './daemon';

type Msg = { type: string; [key: string]: unknown };
/** The n-th message of a type a simulated daemon received, once it arrived. */
async function nth(list: unknown[], type: string, n = 0): Promise<Msg> {
  const of = () => (list as Msg[]).filter(m => m.type === type);
  await expect.poll(() => of().length).toBeGreaterThan(n);
  return of()[n]!;
}
const twoMachines = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the build' };

test('un message au chat avec clarification', async ({ page }) => {
  const local = await fakeDaemon(page, [session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge' })], { machines: twoMachines, daemon: ROUTING });
  const devbox = await fakeRemote(page, 'devbox', [session('pim', { name: 'Pim', project: 'ledge', cwd: '/w/ledge' })]);
  await page.goto('/');
  await expect(page.locator('[data-session="devbox:pim"]')).toBeVisible();

  // Open the chat from the heading: the cursor is in its composer.
  const trigger = page.locator('[data-open-ledge="heading"]');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  const pane = page.locator('#conversation-pane[data-ledge-chat]');
  await expect(pane.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  const reply = page.locator('#ledge-chat-reply');
  await expect(reply).toBeFocused();

  // The question goes to the coordinator with the fleet's inventory; the draft is cleared.
  await reply.fill('Fix the build');
  await reply.press('Control+Enter');
  const first = await nth(local.received, 'chat.route');
  expect(first).toMatchObject({ text: 'Fix the build', tool: 'claude', context: { history: [] } });
  expect((first.context as { machines: { id: string; online: boolean }[] }).machines.map(m => [m.id, m.online])).toEqual([['local', true], ['devbox', true]]);
  await expect(reply).toHaveValue('');
  expect(devbox.received.filter(m => m.type === 'chat.ask')).toEqual([]);

  // Clarification: the machines as buttons, writing stays possible.
  local.push({ type: 'chat.routed', qid: first.qid, result: { machineId: null, text: 'Which machine?', choices: ['local', 'devbox'] } });
  const choices = pane.getByRole('group', { name: 'Suggested machines' });
  await expect(choices.getByRole('button')).toHaveText(['Local', 'Devbox']);
  await expect(pane.getByText('You can also answer in writing.')).toBeVisible();
  await choices.getByRole('button', { name: 'Devbox' }).click();

  // The choice is a new question; the coordinator sees the clarification in the history and sends it to Devbox.
  const second = await nth(local.received, 'chat.route', 1);
  expect(second).toMatchObject({ text: 'On Devbox.', context: { history: [{ question: 'Fix the build', answer: 'Which machine?' }] } });
  await expect(pane.getByRole('group', { name: 'Suggested machines' })).toHaveCount(0);
  local.push({ type: 'chat.routed', qid: second.qid, result: { machineId: 'devbox', text: 'On Devbox.' } });
  const ask = await nth(devbox.received, 'chat.ask');
  expect(ask).toEqual({ type: 'chat.ask', qid: second.qid, text: 'On Devbox.', tool: 'claude' });
  expect(local.received.filter(m => m.type === 'chat.ask')).toEqual([]);

  // Devbox reads, then answers with a proposal.
  devbox.push({ type: 'chat.step', qid: ask.qid, step: { kind: 'pane', id: 'pim', name: 'Pim' } });
  await expect(pane.getByText("Reads Pim's terminal")).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Cancel the current question' })).toBeVisible();
  const at = new Date().toISOString();
  devbox.push({ type: 'chat.done', qid: ask.qid, text: '**Pim** broke the build. Start a session to fix it.', at, proposal });
  await expect(pane.getByRole('button', { name: 'Cancel the current question' })).toHaveCount(0);
  await expect(pane.getByRole('region', { name: 'Proposed session' })).toBeVisible();
  await expect(pane.getByText('Destination: Devbox')).toBeVisible();
  await expect(pane.locator('[data-ledge-mention="devbox:pim"]')).toHaveText('Pim');
  await expect(pane.getByRole('group', { name: 'Sessions mentioned' }).getByRole('button', { name: 'Open Pim' })).toBeEnabled();

  // The card starts the session on Devbox only; New session waits meanwhile.
  await pane.getByRole('button', { name: 'Start the session' }).click();
  expect(await nth(devbox.received, 'session.launch')).toEqual({ type: 'session.launch', tool: proposal.tool, cwd: proposal.cwd, prompt: proposal.prompt, qid: ask.qid });   // no `project`: the daemon uses the proposal bound to the qid
  expect(local.received.filter(m => m.type === 'session.launch')).toEqual([]);
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeDisabled();
  devbox.launched(session('ari', { name: 'Ari', project: 'ledge', cwd: '/w/ledge', state: 'working' }));
  devbox.push({ type: 'chat.history', turns: [{ qid: ask.qid, question: 'On Devbox.', askedAt: at, steps: [{ kind: 'pane', id: 'pim', name: 'Pim' }], answer: '**Pim** broke the build. Start a session to fix it.', answeredAt: at, proposal: { ...proposal, launchedId: 'ari' } }] });
  await expect(pane.getByText('Ari has started')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeEnabled();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');   // the card does not navigate

  // A link opens the new session's conversation, cursor in its reply.
  await pane.getByRole('group', { name: 'Sessions mentioned' }).getByRole('button', { name: 'Open Ari' }).click();
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'devbox:ari');
  await expect(page.locator('#conversation-reply')).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-pressed', 'false');
});

test('no session and Devbox offline: Ledge still answers, a new conversation starts over', async ({ page }) => {
  const local = await fakeDaemon(page, [], { machines: twoMachines, daemon: ROUTING });
  const devbox = await fakeRemote(page, 'devbox', []);
  devbox.close();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();
  await page.locator('[data-open-ledge="empty"]').click();
  const pane = page.locator('#conversation-pane[data-ledge-chat]');
  await expect(pane).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();   // the empty workspace stays beside the chat
  await expect(pane.getByRole('status').filter({ hasText: 'Devbox: connection lost.' })).toBeVisible();

  await pane.getByRole('group', { name: 'Suggestions for Ledge' }).getByRole('button', { name: 'Who needs me?' }).click();
  const route = await nth(local.received, 'chat.route');
  expect(route.text).toBe('Who needs me?');
  expect((route.context as { machines: { id: string; online: boolean }[] }).machines.map(m => [m.id, m.online])).toEqual([['local', true], ['devbox', false]]);
  local.push({ type: 'chat.routed', qid: route.qid, result: { machineId: 'local', text: 'Who needs me?' } });
  const ask = await nth(local.received, 'chat.ask');
  local.push({ type: 'chat.done', qid: ask.qid, text: 'Nobody waits for you.', at: new Date().toISOString() });
  await expect(pane.getByText('Nobody waits for you.')).toBeVisible();
  await expect(pane.locator('.ledge-source')).toContainText('Sources: nothing read');

  // The window never scrolls as a page (spec §12).
  expect(await page.evaluate(() => [document.documentElement.scrollHeight <= window.innerHeight, document.documentElement.scrollWidth <= window.innerWidth])).toEqual([true, true]);

  await pane.getByRole('button', { name: 'New conversation' }).click();
  await nth(local.received, 'chat.reset');
  await expect(pane.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  await expect(pane.getByText('Nobody waits for you.')).toHaveCount(0);
});

test('the chat and an agent keep their own drafts; read-only after a reload without the daemon', async ({ page }) => {
  const local = await fakeDaemon(page, [session('bix', { name: 'Bix', project: 'ledge', cwd: '/w/ledge', state: 'idle' })]);
  await page.goto('/');
  await page.locator('[data-session="local:bix"]').click();
  await page.locator('#conversation-reply').fill('For Bix');

  await page.locator('[data-open-ledge="heading"]').click();
  const reply = page.locator('#ledge-chat-reply');
  await expect(reply).toBeFocused();
  await reply.fill('Who needs me?');
  await reply.press('Control+Enter');
  const ask = await nth(local.received, 'chat.ask');
  local.push({ type: 'chat.done', qid: ask.qid, text: 'Nobody waits.', at: new Date().toISOString() });
  await expect(page.getByText('Nobody waits.')).toBeVisible();
  await reply.fill('Kept for later');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('desktop.drafts') ?? '{}'))).toEqual({ 'local:bix': 'For Bix', ledge: 'Kept for later' });

  local.close();
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(1);
  const pane = page.locator('#conversation-pane[data-ledge-chat]');
  await expect(pane.getByText('Nobody waits.')).toBeVisible();
  await expect(reply).toBeDisabled();
  await expect(reply).toHaveValue('Kept for later');
  await expect(pane.getByRole('group', { name: 'Suggestions for Ledge' }).getByRole('button', { name: 'Who needs me?' })).toBeDisabled();
  await expect(pane.getByRole('status').filter({ hasText: 'The history with Ledge stays readable.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.drafts') ?? '{}')['local:bix'])).toBe('For Bix');
});
