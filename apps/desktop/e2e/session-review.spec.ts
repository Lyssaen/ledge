import type { Page } from '@playwright/test';
import type { ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { at, fleet, ottoThread, tool } from './thread';

// A 400-character line (words, as code reads): the diff scrolls sideways, never the page.
const wide = `export const wide = '${'lorem ipsum dolor sit amet '.repeat(14).slice(0, 377)}';`;
/** Otto's thread, with two more writes (src/App.tsx again, docs/guide.md), a Write of wide.ts whose line is 400 characters long,
 *  a reply that links docs/guide.md and a TodoWrite update. Changes walk: src/App.tsx, docs/guide.md, wide.ts. */
const review: ThreadItem[] = [
  ...ottoThread,
  tool('t6', -7, 'Write', '/w/ledge/src/App.tsx', { turn: 2, files: [{ path: '/w/ledge/src/App.tsx', change: 'write', diff: '- b\n+ c' }] }),
  tool('t7', -6, 'Write', '/w/ledge/docs/guide.md', { turn: 2, files: [{ path: '/w/ledge/docs/guide.md', change: 'add', diff: '+ # Guide\n+ \n+ Bonjour.' }] }),
  tool('t8', -5, 'Write', '/w/ledge/wide.ts', { turn: 2, files: [{ path: '/w/ledge/wide.ts', change: 'add', diff: `+ ${wide}` }] }),
  tool('t9', -4, 'TodoWrite', 'Plan', { turn: 2, input: JSON.stringify({ todos: [
    { content: 'Lire les tests', status: 'completed', activeForm: 'Lecture des tests' },
    { content: 'Corriger les tests', status: 'in_progress', activeForm: 'Correction des tests' },
    { content: 'Relancer la suite', status: 'pending', activeForm: 'Relance de la suite' }
  ] }) }),
  { kind: 'reply', id: 'reply-2', at: at(-3), turn: 2, text: 'Le guide est prêt : [docs/guide.md](docs/guide.md).' }
];
const documents = { 'docs/guide.md': '# Guide\n\nBonjour.' };

const open = async (page: Page) => { await page.getByRole('tab', { name: 'List' }).click(); await page.getByRole('listitem', { name: /^Otto,/ }).click(); };

test('Changes: J / K walk the files; a 400-character line scrolls in the diff only', async ({ page }) => {
  expect(wide).toHaveLength(400);
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  await page.getByRole('tab', { name: /^Changes/ }).click();
  await expect(page.locator('.file-title code')).toHaveText('src/App.tsx');
  await page.keyboard.press('j'); await page.keyboard.press('j');
  await expect(page.locator('.file-title code')).toHaveText('wide.ts');
  expect(await page.locator('.diff-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.locator('.session-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press('k');
  await expect(page.locator('.file-title code')).toHaveText('docs/guide.md');
});
test('the pane beside the thread: dragging the handle resizes it, the thread keeps 440 px, the width survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  await expect(page.getByRole('complementary', { name: 'Reading pane' }).getByText('Bonjour.')).toBeVisible();
  // Wide, the pane stands beside the thread (the handle takes 1 px of the thread's 440: margin 0 -3px on 7 px, as in the mock-up).
  expect(await page.getByRole('complementary', { name: 'Reading pane' }).evaluate(el => getComputedStyle(el).position)).toBe('static');
  const handle = page.getByRole('separator', { name: 'Resize the pane' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x - 2000, box.y + 200); await page.mouse.up();
  expect((await page.locator('.session-main').boundingBox())!.width).toBeGreaterThanOrEqual(439);
  const split = await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.session')!).split);
  expect(split).toBe(0.72);
  await page.reload();
  await open(page);
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  expect(await page.locator('.session-split').evaluate(el => getComputedStyle(el).getPropertyValue('--split').trim())).toBe('72%');
});
test('a narrow conversation (terminal open): the pane covers the thread above the reply, with Close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  await page.keyboard.press('o');
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible();
  expect((await page.locator('.session-page').boundingBox())!.width).toBeLessThan(860);
  await page.getByRole('link', { name: 'docs/guide.md' }).click();
  const pane = page.getByRole('complementary', { name: 'Reading pane' });
  await expect(pane.getByText('Bonjour.')).toBeVisible();
  expect(await pane.evaluate(el => getComputedStyle(el).position)).toBe('absolute');
  const reply = (await page.locator('.session-reply').boundingBox())!, side = (await pane.boundingBox())!;
  expect(side.y + side.height).toBeLessThanOrEqual(reply.y + 1);
  await pane.getByRole('button', { name: 'Close the pane (Esc)' }).click();
  await expect(pane).toHaveCount(0);
});
test('the work plan bar stays on top while the thread scrolls', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: review }, documents });
  await page.goto('/');
  await open(page);
  const bar = page.locator('.todo-bar');
  await expect(bar).toBeVisible();
  await page.locator('.session-thread').evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await page.locator('.session-thread').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const top = (await page.locator('.session-thread').boundingBox())!.y;
  expect(Math.abs((await bar.boundingBox())!.y - top)).toBeLessThan(12);
});
