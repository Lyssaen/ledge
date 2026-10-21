import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openChat } from './scenarios';

/* The chat proposes to close two sessions, the user closes them from the card (spec 2026-10-21 close-from-chat). */
const closes = [{ id: 'otto', name: 'Otto', tool: 'claude' }, { id: 'pim', name: 'Pim', tool: 'claude' }];

test('« Close all » sends session.close; the marks read closed and force closed', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'idle' }), session('pim', { name: 'Pim', state: 'idle' })]);
  await ready(page, 2);
  await openChat(page);
  await layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' }).fill('close Otto and Pim');
  await page.keyboard.press('Enter');
  await expectMode(page, 'chat');
  const ask = await received(d.received, 'chat.ask');
  const answeredAt = new Date().toISOString();
  const turn = { qid: ask.qid, question: ask.text, askedAt: answeredAt, steps: [], answer: 'I would close these two.', answeredAt };
  d.emit({ type: 'chat.done', qid: ask.qid, text: turn.answer, at: answeredAt, closes });
  const card = layer(page, 'chat').getByRole('region', { name: '2 sessions to close' });
  await expect(card).toContainText('Otto');
  await card.getByRole('button', { name: /Close all/ }).click();
  expect(await received(d.received, 'session.close')).toEqual({ type: 'session.close', qid: ask.qid, rows: [0, 1] });
  await expect(card.getByRole('button', { name: 'Closing…' })).toHaveCount(2);
  d.emit({ type: 'chat.history', turns: [{ ...turn, closes: [{ ...closes[0], closedAt: answeredAt, how: 'exit' }, { ...closes[1], closedAt: answeredAt, how: 'killed' }] }] });
  await expect(card).toContainText('Closed');
  await expect(card).toContainText('Force closed');
  await expect(card.getByRole('button')).toHaveCount(0);
  await expectMode(page, 'chat');
});
