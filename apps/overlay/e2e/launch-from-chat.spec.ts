import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openChat } from './scenarios';
import type { ChatProposal } from '@ledge/protocol';

/* The chat proposes a session, the user starts it from the card (spec 2026-10-12). */
const proposal: ChatProposal = { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the overlay build' };

async function askForSession(page: Parameters<typeof fakeDaemon>[0]) {
  // Lot 4: the notch writes to Ledge (`ledge.say`); the answer and its card come back in Ledge's thread.
  const d = await fakeDaemon(page, [session('otto'), session('pim', { name: 'Pim' })], { chat: { text: 'Here is the session I would start.', proposal } });
  await ready(page, 2);
  await openChat(page);
  await layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' }).fill('open a session in ledge to fix the overlay build');
  await page.keyboard.press('Enter');
  await expectMode(page, 'chat');
  await received(d.received, 'ledge.say');
  const turn = d.said(1);
  return { d, ask: { qid: turn.qid }, turn };
}

test('a proposal shows a card; Start sends its qid; the card turns into the started companion', async ({ page }) => {
  const { d, ask, turn } = await askForSession(page);
  const card = layer(page, 'chat').getByRole('region', { name: 'Proposed session' });
  await expect(card).toContainText('/home/u/ledge');
  await expect(card).toContainText('Claude Code · default');
  await card.getByRole('button', { name: /Start the session/ }).click();
  expect(await received(d.received, 'session.launch')).toEqual({ type: 'session.launch', tool: 'claude', cwd: '/home/u/ledge', prompt: 'Fix the overlay build', qid: ask.qid });
  d.launched(session('n1', { name: 'Juno', project: 'ledge', cwd: '/home/u/ledge', title: 'Juno · ledge', state: 'starting' }));
  d.emit({ type: 'chat.history', turns: [{ ...turn, proposal: { ...proposal, launchedId: 'n1' } }] });
  await expect(card).toContainText('Juno has started');
  await expect(card.getByRole('button', { name: 'Terminal' })).toBeVisible();
  await expectMode(page, 'chat');
});

test('a failed launch shows the reason; Retry sends it again', async ({ page }) => {
  const { d, ask, turn } = await askForSession(page);
  const card = layer(page, 'chat').getByRole('region', { name: 'Proposed session' });
  await expect(card).toContainText('/home/u/ledge');
  await card.getByRole('button', { name: /Start the session/ }).click();
  await received(d.received, 'session.launch');
  d.refuse('no such folder: /home/u/ledge');
  d.emit({ type: 'chat.history', turns: [{ ...turn, proposal: { ...proposal, error: 'no such folder: /home/u/ledge' } }] });
  await expect(card.getByRole('alert')).toHaveText('Could not start: no such folder: /home/u/ledge');
  await card.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.launch' && m.qid === ask.qid).length).toBe(2);
});
