import type { Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects, type ChatReply } from './daemon';

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
  await page.goto('/');
  await expect(ledgeTable(page)).toBeVisible();
}
/** `/` from the atelier: the chat opens with the focus in its field, then a question sent with Enter. */
async function ask(page: Page, question: string) {
  await page.keyboard.press('/');
  await expect(panel(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
}

test('/, a question, the answer: hovering Otto lights him at his table; the atelier stays in view and narrows, with no side scroll', async ({ page }) => {
  const chat: ChatReply = { steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'otto', name: 'Otto' }], text: '**Otto** is waiting for your approval to run npm test.' };
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, chat });
  await boot(page);
  const before = await scroll(page).evaluate(e => e.clientWidth);
  await ask(page, 'Who needs me?');
  // The question goes to the daemon with Claude, once.
  await expect.poll(() => sent(daemon.received, 'chat.ask').length).toBe(1);
  expect(sent(daemon.received, 'chat.ask')[0]).toMatchObject({ text: 'Who needs me?', tool: 'claude' });
  const otto = panel(page).getByRole('link', { name: 'Otto' });
  await expect(otto).toBeVisible();
  await expect(panel(page)).toContainText('is waiting for your approval to run npm test.');
  // The panel is docked beside the atelier: the atelier narrows by its width and nothing scrolls sideways.
  const after = await scroll(page).evaluate(e => e.clientWidth);
  expect(after).toBeLessThan(before);
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
  await expect.poll(() => sent(daemon.received, 'session.launch').length).toBe(1);
  const launch = sent(daemon.received, 'session.launch')[0]!;
  const qid = sent(daemon.received, 'chat.ask')[0]!.qid;
  expect(launch).toMatchObject({ qid, tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the failing tests' });
  // The fake daemon names the agent `Agent 1`: it sits at the Ledge table, its seat lit, and the notice says where it starts.
  const seat = ledgeTable(page).getByRole('button', { name: /^Agent 1,/ });
  await expect(seat).toHaveClass(/just-seated/);
  await expect(seat.locator('[data-badge]')).toHaveText('Starting');
  await expect(page.locator('.toast')).toHaveText('Agent 1 is starting at the Ledge table.');
  // The card shows it started, the chat stays open, and nothing launched a second time.
  await expect(card).toHaveAttribute('data-launch-card', 'launched');
  await expect(card).toContainText('Agent 1 has started');
  await expect(card.getByRole('button', { name: 'Start the session' })).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  expect(sent(daemon.received, 'session.launch')).toHaveLength(1);
});

test('a 900 px window: the chat opens over the atelier, Escape closes it, and the focus is back on the page', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await boot(page);
  const before = await scroll(page).evaluate(e => e.clientWidth);
  await page.keyboard.press('/');
  await expect(panel(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  // Over the atelier (the mockup's ≤ 900 px rule): fixed on the right edge, the atelier keeps its width, nothing scrolls sideways.
  await expect(panel(page)).toHaveCSS('position', 'fixed');
  const box = (await panel(page).boundingBox())!;
  expect(Math.round(box.x + box.width)).toBe(900);
  expect(box.width).toBeLessThanOrEqual(400);
  expect(await scroll(page).evaluate(e => e.clientWidth)).toBe(before);
  expect(await pageNoSideScroll(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  // The focus is back on the page: nothing inside a closed chat holds it, and the window's single keys answer again.
  expect(await page.evaluate(() => document.activeElement === document.body || !document.activeElement?.closest('.ledge-chat-panel'))).toBe(true);
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'New session' })).toBeVisible();
});
