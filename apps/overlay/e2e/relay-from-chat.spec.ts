import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList } from './scenarios';

/* The chat proposes an instruction for Otto, the user sends it from the card (spec 2026-10-12 relay). */
const relay = { id: 'otto', name: 'Otto', tool: 'claude', text: 'Run the overlay tests' };

async function askForRelay(page: Parameters<typeof fakeDaemon>[0], ottoState: 'working' | 'idle') {
  const d = await fakeDaemon(page, [session('otto', { name: 'Otto', state: ottoState }), session('pim', { name: 'Pim' })]);
  await ready(page, 2);
  await openList(page);
  await layer(page, 'list').getByRole('textbox', { name: 'Ask Ledge' }).fill('tell Otto to run the overlay tests');
  await page.keyboard.press('Enter');
  await expectMode(page, 'chat');
  const ask = await received(d.received, 'chat.ask');
  const answeredAt = new Date().toISOString();
  const turn = { qid: ask.qid, question: ask.text, askedAt: answeredAt, steps: [], answer: 'I will pass it on to Otto.', answeredAt };
  d.emit({ type: 'chat.done', qid: ask.qid, text: turn.answer, at: answeredAt, relay });
  return { d, ask, turn };
}

test('a busy session: the card waits, then reads sent once the daemon sends it', async ({ page }) => {
  const { d, ask, turn } = await askForRelay(page, 'working');
  const card = layer(page, 'chat').getByRole('region', { name: 'Instruction to send' });
  await expect(card).toContainText('Run the overlay tests');
  await expect(card).toContainText('working');
  await card.getByRole('button', { name: /Send/ }).click();
  expect(await received(d.received, 'session.relay')).toEqual({ type: 'session.relay', qid: ask.qid });
  d.emit({ type: 'chat.history', turns: [{ ...turn, relay: { ...relay, status: 'queued' } }] });
  await expect(card).toContainText("Otto is working; I'll send it as soon as it's done");
  await expect(card.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  d.upsert(session('otto', { name: 'Otto', state: 'idle' }));
  d.emit({ type: 'chat.history', turns: [{ ...turn, relay: { ...relay, status: 'sent', sentAt: new Date().toISOString() } }] });
  await expect(card).toContainText(/Sent to Otto · \d{2}:\d{2}/);
  await expectMode(page, 'chat');
});

test('a failed send shows the reason; Retry sends it again', async ({ page }) => {
  const { d, ask, turn } = await askForRelay(page, 'idle');
  const card = layer(page, 'chat').getByRole('region', { name: 'Instruction to send' });
  await card.getByRole('button', { name: /Send/ }).click();
  await received(d.received, 'session.relay');
  d.emit({ type: 'chat.history', turns: [{ ...turn, relay: { ...relay, error: 'the agent did not take the answer' } }] });
  d.refuse('the agent did not take the answer');
  await expect(card.getByRole('alert')).toHaveText('Could not send: the agent did not take the answer');
  await card.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.relay' && m.qid === ask.qid).length).toBe(2);
});
