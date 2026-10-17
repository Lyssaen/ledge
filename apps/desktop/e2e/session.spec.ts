import type { Page } from '@playwright/test';
import type { ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, T0, twoProjects } from './daemon';

const fleet = eight.map(s => s.id === 'otto'
  ? { ...s, pending: { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const }, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' as const }] }
  : s.id === 'luna' ? { ...s, pending: { kind: 'question' as const, text: 'Quel port ?', source: 'hook' as const } } : s);

const base = new Date(T0).getTime();
const at = (s: number) => new Date(base + s * 1000).toISOString();
const tool = (id: string, s: number, name: string, label: string, extra: Record<string, unknown> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra }) as ThreadItem;
const ottoThread: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(-600), turn: 1, text: 'Câble la liste' },
  tool('t1', -590, 'Read', '/w/ledge/src/App.tsx', { durationMs: 400 }),
  tool('t2', -580, 'Grep', 'useKeys', { durationMs: 300 }),
  tool('t3', -570, 'Edit', '/w/ledge/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }] }),
  { kind: 'message', id: 'msg-1', at: at(-560), turn: 1, text: 'Je lance les tests.' },
  { kind: 'permission', id: 'perm-1', at: at(-550), turn: 1, tool: 'Bash', text: 'npm test', decision: 'accept' },
  tool('t4', -540, 'Bash', 'npm test', { status: 'failed', error: 'exit 1', durationMs: 6800 }),
  { kind: 'helper', id: 'h1', at: at(-530), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'working' },
  { kind: 'message', id: 'msg-h', at: at(-525), turn: 1, helperId: 'h1', text: 'Je lis.' },
  { kind: 'reply', id: 'reply-1', at: at(-520), turn: 1, text: 'Deux tests échouent.' },
  { kind: 'prompt', id: 'prompt-2', at: at(-10), turn: 2, text: 'Corrige-les' },
  { kind: 'permission', id: 'perm-2', at: at(-9), turn: 2, tool: 'Bash', text: 'npm test' },
  tool('t5', -8, 'Bash', 'npm test', { turn: 2, status: 'running' })
];
const longThread: ThreadItem[] = Array.from({ length: 120 }, (_, i): ThreadItem[] => {
  const turn = i + 1; const s = -3000 + i * 20;
  return [
    { kind: 'prompt', id: `p${turn}`, at: at(s), turn, text: `Consigne ${turn}` },
    tool(`a${turn}`, s + 1, 'Read', `/w/ledge/f${turn}.ts`, { turn }),
    { kind: 'reply', id: `r${turn}`, at: at(s + 2), turn, text: Array.from({ length: 6 }, (_, k) => `Réponse ${turn} ligne ${k + 1}`).join('\n\n') }
  ];
}).flat();

const open = async (page: Page, name: string) => { await page.getByRole('tab', { name: 'List' }).click(); await page.getByRole('listitem', { name: new RegExp(`^${name},`) }).click(); };
const thread = (page: Page) => page.locator('.session-thread');
const gap = (page: Page) => thread(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);

test('the session reads as a flat thread; actions unfold; Y allows the pinned request once', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.goto('/');
  await open(page, 'Otto');
  await expect(thread(page).getByText('Câble la liste')).toBeVisible();
  await thread(page).getByRole('button', { name: /^3 actions/ }).click();
  await expect(thread(page).locator('.action-list:not(.compact) .action-row')).toHaveCount(3);
  await page.keyboard.press('y');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]);
  await expect(page.getByRole('region', { name: 'Approval requested' })).toHaveCount(0);
});
test('reading older messages while new ones arrive: no jump, then « Go to the latest message »', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: longThread } });
  await page.goto('/');
  await open(page, 'Nova');
  const scroller = thread(page);
  await expect(scroller.locator('.turn')).toHaveCount(120);
  await expect.poll(() => gap(page)).toBeLessThan(60);
  await scroller.evaluate(el => { el.scrollTop = 400; });
  daemon.item('nova', { kind: 'message', id: 'msg-live', at: new Date().toISOString(), turn: 120, text: 'Encore une chose.' });
  await expect(scroller.getByText('Encore une chose.')).toBeAttached();
  expect(Math.abs(await scroller.evaluate(el => el.scrollTop) - 400)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Go to the latest message' }).click();
  await expect.poll(() => gap(page)).toBeLessThan(60);
  await expect(page.getByRole('button', { name: 'Go to the latest message' })).toHaveCount(0);
});
test('at the end of the thread, a new item stays in view', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: longThread } });
  await page.goto('/');
  await open(page, 'Nova');
  await expect(thread(page).locator('.turn')).toHaveCount(120);
  daemon.item('nova', { kind: 'reply', id: 'reply-live', at: new Date().toISOString(), turn: 120, text: 'Terminé.' });
  await expect(thread(page).getByText('Terminé.')).toBeInViewport();
});
test('Reply from the List lands in the field; Enter sends the reply', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.getByRole('listitem', { name: /^Luna,/ }).hover();
  await page.getByRole('listitem', { name: /^Luna,/ }).getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('textbox', { name: 'Reply to the agent' })).toBeFocused();
  await page.keyboard.type('Port 3000');
  await page.keyboard.press('Enter');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'luna', text: 'Port 3000' }]);
});
test('the terminal on O follows from agent to agent and survives a reload', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await open(page, 'Otto');
  daemon.preview('otto', ['$ npm test']); daemon.preview('nova', ['$ git status']);
  await page.keyboard.press('o');
  await expect(page.getByRole('region', { name: 'Terminal' }).getByText('$ npm test')).toBeVisible();
  await page.getByRole('navigation', { name: /^Agents of the project/ }).getByRole('button', { name: /^Nova/ }).click();
  await expect(page.getByRole('region', { name: 'Terminal' }).getByText('$ git status')).toBeVisible();
  await page.reload();
  await open(page, 'Otto');
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible();
});
test('under 1000 px the rail steps aside; the reading column stays centred at 760 px at most', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto('/');
  await open(page, 'Otto');
  await expect(page.locator('.project-rail')).toBeHidden();
  const turn = (await thread(page).locator('.turn').first().boundingBox())!;
  expect(turn.width).toBeLessThanOrEqual(760);
  expect(await page.locator('.session-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
