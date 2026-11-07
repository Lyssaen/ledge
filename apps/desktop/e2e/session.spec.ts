import type { Page } from '@playwright/test';
import type { ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { at, fleet, ottoThread, tool } from './thread';

const longThread: ThreadItem[] = Array.from({ length: 120 }, (_, i): ThreadItem[] => {
  const turn = i + 1; const s = -3000 + i * 20;
  return [
    { kind: 'prompt', id: `p${turn}`, at: at(s), turn, text: `Consigne ${turn}` },
    tool(`a${turn}`, s + 1, 'Read', `/w/ledge/f${turn}.ts`, { turn }),
    { kind: 'reply', id: `r${turn}`, at: at(s + 2), turn, text: Array.from({ length: 6 }, (_, k) => `Réponse ${turn} ligne ${k + 1}`).join('\n\n') }
  ];
}).flat();

const open = async (page: Page, name: string) => { await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).click(); };
const thread = (page: Page) => page.locator('.session-thread');
const gap = (page: Page) => thread(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);

test('the session reads as a rail; the past exchange stays open, one of the last three; Y allows the pinned request once', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  await expect(thread(page).locator('.turn.folded')).toHaveCount(0);
  await expect(thread(page).getByText('Câble la liste', { exact: true })).toBeVisible();
  await expect(thread(page).locator('.turn').first().locator('li.action-row')).toHaveCount(4);
  await page.keyboard.press('y');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept', expect: { kind: 'permission', text: 'npm test', key: expect.any(String) } }]);
  await expect(page.getByRole('region', { name: 'Approval requested' })).toHaveCount(0);
});
test('reading older messages while new ones arrive: no jump, then « Go to the latest message »', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: longThread } });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Nova');
  const scroller = thread(page);
  await expect(scroller.locator('.turn')).toHaveCount(120);
  await expect.poll(() => gap(page)).toBeLessThan(60);
  await scroller.evaluate(el => { el.scrollTop = 400; });
  await expect(page.getByRole('button', { name: 'Go to the latest message' })).toBeVisible();
  daemon.item('nova', { kind: 'message', id: 'msg-live', at: new Date().toISOString(), turn: 120, text: 'Encore une chose.' });
  await expect(scroller.getByText('Encore une chose.')).toBeAttached();
  for (let i = 0; i < 8; i++) { expect(Math.abs(await scroller.evaluate(el => el.scrollTop) - 400)).toBeLessThan(2); await page.waitForTimeout(40); }
  await page.getByRole('button', { name: 'Go to the latest message' }).click();
  await expect.poll(() => gap(page)).toBeLessThan(60);
  await expect(page.getByRole('button', { name: 'Go to the latest message' })).toHaveCount(0);
});
test('at the end of the thread, a new item stays in view', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: longThread } });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Nova');
  await expect(thread(page).locator('.turn')).toHaveCount(120);
  daemon.item('nova', { kind: 'reply', id: 'reply-live', at: new Date().toISOString(), turn: 120, text: 'Terminé.' });
  await expect(thread(page).getByText('Terminé.')).toBeInViewport();
});
test('Reply from the sidebar lands in the field; Enter sends the reply', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await page.getByRole('complementary').getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('textbox', { name: 'Reply to the agent' })).toBeFocused();
  await page.keyboard.type('Port 3000');
  await page.keyboard.press('Enter');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'luna', text: 'Port 3000' }]);
});
test('the Terminal view follows from agent to agent and survives a reload', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  await expect(page.locator('.session-page')).toBeVisible();
  daemon.preview('otto', ['$ npm test']); daemon.preview('nova', ['$ git status']);
  await page.getByRole('tab', { name: /^Terminal/ }).click();
  await expect(page.getByRole('region', { name: 'Terminal' }).getByText('$ npm test')).toBeVisible();
  await page.getByRole('tree', { name: 'Projects, branches and sessions' }).getByRole('button', { name: /^Nova/ }).click();
  // Agents run in project order, oldest first then by id: bix, echo, nova, otto, pim.
  const terminal = page.getByRole('region', { name: 'Terminal' });
  await expect(terminal.getByText('$ git status')).toBeVisible();
  await expect(terminal.getByText('$ npm test')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(terminal.getByText('$ npm test')).toBeVisible();
  await expect(terminal.getByText('$ git status')).toHaveCount(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(terminal.getByText('$ git status')).toBeVisible();
  await expect(terminal.getByText('$ npm test')).toHaveCount(0);
  await page.reload(); await openAtelier(page);
  await open(page, 'Otto');
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible();
});
test("under 1000 px the thread's rail stays centred at 820 px at most (the mockup's), beside no rail of agents", async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  await expect(page.locator('.project-rail')).toHaveCount(0);
  const rail = (await thread(page).locator('.rail').boundingBox())!;
  expect(rail.width).toBeLessThanOrEqual(820);
  expect(await page.locator('.session-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

// The page under 600 px (the interface without the IDE): session.css's narrow rules come after the base rules they override,
// so a change's row drops its verb, shortens « View the change » to « View », and keeps its path readable, the link before
// the duration.
test('a session page under 600 px keeps a change\'s row readable: the path, then « View », before the duration', async ({ page }) => {
  const changed: ThreadItem[] = [
    { kind: 'prompt', id: 'p1', at: at(-120), turn: 1, text: 'Écris le module' },
    tool('w1', -110, 'Write', '/w/ledge/src/module-avec-un-nom-long.ts', { turn: 1, durationMs: 200, files: [{ path: '/w/ledge/src/module-avec-un-nom-long.ts', change: 'edit', diff: '- old\n+ new' }] }),
    { kind: 'reply', id: 'r1', at: at(-100), turn: 1, text: 'Écrit.' }
  ];
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: changed } });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  // Opened at the usual size (the tree folds away when narrow), then the window narrowed.
  await page.setViewportSize({ width: 600, height: 900 });
  const row = thread(page).locator('.action-row.is-change').last();
  await expect(row).toBeVisible();
  expect(await page.locator('.session-page').evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(600);
  const geo = await row.evaluate(r => {
    const b = (s: string) => { const e = r.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { l: x.left, r: x.right, w: x.width }; };
    const tg = r.querySelector('.action-target') as HTMLElement;
    const probe = document.createElement('span'); probe.style.font = getComputedStyle(tg).font; probe.textContent = 'xx'; document.body.append(probe);
    const two = probe.getBoundingClientRect().width; probe.remove();
    return { target: b('.action-target'), link: b('.action-link'), time: b('.action-time'), act: b('.act'), verb: getComputedStyle(r.querySelector('.action-verb')!).display, two,
      cols: getComputedStyle(r).gridTemplateColumns, vb: r.querySelector('.vb')!.getBoundingClientRect().width, linkFont: getComputedStyle(r.querySelector('.action-link')!).fontSize };
  });
  // The narrow rules hold: the rail's 32 px column, no 86 px slot kept for the hidden verb, the link's long words gone.
  expect(geo.cols.startsWith('32px')).toBe(true);
  expect(geo.vb).toBeLessThan(86);
  expect(geo.linkFont).toBe('0px');
  expect(geo.verb).toBe('none');
  expect(geo.target!.w).toBeGreaterThan(geo.two);
  expect(geo.link!.r).toBeLessThanOrEqual(geo.time!.l);
  expect(geo.link!.r).toBeLessThanOrEqual(geo.act!.r + 0.5);
  await expect(row.locator('.action-link')).toHaveAttribute('data-short', 'View');
  await row.screenshot({ path: 'e2e/.results/session-narrow-row.png' });
});
