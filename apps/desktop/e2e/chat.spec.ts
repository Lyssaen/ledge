import type { Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects, type ChatReply } from './daemon';
import { ideReady } from './ide';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

/** Three agents: two at the Ledge table, one at Website, so a new one has a free seat. */
const fleet = eight.filter(s => ['otto', 'nova', 'luna'].includes(s.id));

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Of<T> => m.type === type);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Chat Ledge' });
const field = (page: Page) => panel(page).getByPlaceholder('Ask Ledge…');
const scroll = (page: Page) => page.locator('.overview-scroll');
const ledgeTable = (page: Page) => page.getByRole('region', { name: 'Ledge table' });
const pageNoSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const scrollNoSideScroll = (page: Page) => scroll(page).evaluate(e => e.scrollWidth <= e.clientWidth + 1);

async function boot(page: Page) {
  await page.goto('/'); await ideReady(page);
  await expect(ledgeTable(page)).toBeVisible();
}
/** The IDE's right panel is the chat with Ledge, docked beside the editor from the start (Ctrl+/ hides it); Enter sends the question. */
async function ask(page: Page, question: string) {
  await expect(panel(page)).toBeVisible();
  const askField = field(page);
  await askField.click();
  await askField.fill(question);
  await askField.press('Enter');
}

test('a question, the answer: hovering Otto lights him at his table; the atelier stays in view beside the chat, with no side scroll', async ({ page }) => {
  const chat: ChatReply = { steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'otto', name: 'Otto' }], text: '**Otto** is waiting for your approval to run npm test.' };
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, chat });
  await boot(page);
  await ask(page, 'Who needs me?');
  // The question goes to the daemon with Claude, once.
  await expect.poll(() => sent(daemon.received, 'chat.ask').length).toBe(1);
  expect(sent(daemon.received, 'chat.ask')[0]).toMatchObject({ text: 'Who needs me?', tool: 'claude' });
  const otto = panel(page).getByRole('link', { name: 'Otto' });
  await expect(otto).toBeVisible();
  await expect(panel(page)).toContainText('is waiting for your approval to run npm test.');
  // The panel is docked beside the atelier: the atelier stays in view, ending where the chat starts, and nothing scrolls sideways.
  const atelier = (await scroll(page).boundingBox())!, side = (await panel(page).boundingBox())!;
  expect(atelier.x + atelier.width).toBeLessThanOrEqual(side.x + 1);
  await expect(ledgeTable(page)).toBeVisible();
  expect(await pageNoSideScroll(page)).toBe(true);
  expect(await scrollNoSideScroll(page)).toBe(true);
  // Hovering the name lights Otto's seat, and only his; leaving the name puts the light out.
  const seat = scroll(page).locator('[data-agent="local:otto"]');
  await otto.hover();
  await expect(seat).toHaveClass(/chat-hover/);
  await expect(scroll(page).locator('.chat-hover')).toHaveCount(1);
  await field(page).hover();
  await page.mouse.move(5, 400);
  await expect(seat).not.toHaveClass(/chat-hover/);
  await expect(scroll(page).locator('.chat-hover')).toHaveCount(0);
});

test('a session card: one click, the agent sits at the Ledge table with its seat lit, and the card shows it started', async ({ page }) => {
  const chat: ChatReply = {
    steps: [{ kind: 'sessions' }],
    text: 'I can start a session in ledge to fix the failing tests.',
    proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the failing tests' }
  };
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, chat });
  await boot(page);
  await ask(page, 'Start a session to fix the tests');
  const card = panel(page).getByRole('region', { name: 'Proposed session' });
  await expect(card).toHaveAttribute('data-launch-card', 'proposed');
  await expect(card).toContainText('Fix the failing tests');
  await card.getByRole('button', { name: 'Start the session' }).click();
  // The fake daemon names the agent `Agent 1`: it sits at the Ledge table, its seat lit (for 1.6 s: checked first, before
  // anything that could outlast it), and the notice says where it starts.
  const seat = ledgeTable(page).getByRole('button', { name: /^Agent 1,/ });
  await expect(seat).toHaveClass(/just-seated/);
  await expect(seat.locator('[data-badge]')).toHaveText('Starting');
  await expect.poll(() => sent(daemon.received, 'session.launch').length).toBe(1);
  const launch = sent(daemon.received, 'session.launch')[0]!;
  const qid = sent(daemon.received, 'chat.ask')[0]!.qid;
  expect(launch).toMatchObject({ qid, tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the failing tests' });
  await expect(page.locator('.toast')).toHaveText('Agent 1 is starting at the Ledge table.');
  // The card shows it started, the chat stays open, and nothing launched a second time.
  await expect(card).toHaveAttribute('data-launch-card', 'launched');
  await expect(card).toContainText('Agent 1 has started');
  await expect(card.getByRole('button', { name: 'Start the session' })).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  expect(sent(daemon.received, 'session.launch')).toHaveLength(1);
});

test('Escape in the chat\'s field gives the keyboard back to the page: the window\'s single keys answer again', async ({ page }) => {
  // Under 1280 px the IDE's states are still to be drawn (plan 4.1 point 5): the old chat over the atelier at 900 px is not checked.
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await boot(page);
  await field(page).click();
  await expect(field(page)).toBeFocused();
  await page.keyboard.press('Escape');
  // The focus is back on the page, in no field, so the window's single keys answer again.
  expect(await page.evaluate(() => document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ?? false)).toBe(false);
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'New session' })).toBeVisible();
});

test('a session card\'s model is a chip opening a searchable list that stays in the window; the pick leaves with the launch (#62)', async ({ page }) => {
  const cursor = [
    { id: 'auto', label: 'Auto', description: 'Picks for you', isDefault: true },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `claude-4-opus-${i}`, label: `Opus ${i}`, description: i === 7 ? 'Careful and slow' : 'Fast' }))
  ];
  const chat: ChatReply = { steps: [{ kind: 'sessions' }], text: 'I can start Cursor in ledge.', proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'cursor', prompt: 'Fix the failing tests' } };
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, chat, daemon: { version: '0.13.0', install: 'npm', systemd: true, models: true }, models: { cursor } });
  await boot(page);
  await ask(page, 'Start a session to fix the tests');
  const card = panel(page).getByRole('region', { name: 'Proposed session' });
  await expect(card.locator('select')).toHaveCount(0);
  await card.getByRole('button', { name: /^Cursor Agent model : Auto/ }).click();
  const menu = page.getByRole('dialog', { name: 'Cursor Agent model' });
  await expect(menu.getByRole('combobox')).toBeFocused();
  await menu.getByRole('combobox').fill('careful');
  await expect(menu.getByText('1 of 41')).toBeVisible();
  const box = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width); expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await page.screenshot({ path: process.env.CARD_SHOT ?? 'test-results/chat-card-model.png' });
  await menu.getByRole('option', { name: /Opus 7/ }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(card.getByRole('button', { name: 'Cursor Agent model : Opus 7' })).toBeVisible();
  await card.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => sent(daemon.received, 'session.launch').length).toBe(1);
  expect(sent(daemon.received, 'session.launch')[0]).toMatchObject({ tool: 'cursor', model: 'claude-4-opus-7' });
});
