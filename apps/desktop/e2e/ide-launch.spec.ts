import type { Locator, Page } from '@playwright/test';
import type { ClientMessage, HarnessUsage, Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// The IDE's « Nouvelle session » as a modal (lot 4) at the mockup's size (docs/mockups/ledge-ide-interactive.html, launchPage()):
// a group's +, N, the palette's line open it; Ctrl+Enter launches and the new session's tab is the active one; Escape closes it
// and gives the focus back. The zoomed captures (dark, light) are compared by eye with the mockup's own modal.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

type Launch = Extract<ClientMessage, { type: 'session.launch' }>;
const launchesOf = (received: ClientMessage[]) => received.filter((m): m is Launch => m.type === 'session.launch');
const box = async (l: Locator) => (await l.boundingBox())!;
/** A clip around a box, with room under it for a list it opens. */
const d0 = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x, y: b.y, width: b.width, height: b.height + 160 });
const tabs = (page: Page) => page.locator('.ide-dockview .dv-tab');
const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
/** Claude's account over the 80 % threshold (amber), Codex under it; Cursor and OMP not read. */
const harnesses: HarnessUsage[] = [
  { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: at(-1), windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(65) }] },
  { harness: 'codex', account: null, status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: at(170) }] }
];

async function boot(page: Page, o: { lang?: 'fr' | 'en'; theme?: 'dark' | 'light'; projects?: Projects; models?: NonNullable<Parameters<typeof fakeDaemon>[2]>['models'] } = {}) {
  await page.addInitScript(([l, t]) => {
    try { if (l) localStorage.setItem('desktop.lang', l); if (t) localStorage.setItem('desktop.theme', t); } catch { /* ignore */ }
  }, [o.lang ?? '', o.theme ?? '']);
  const daemon = await fakeDaemon(page, eight, { projects: o.projects ?? twoProjects, usage: { harnesses, alerts: [], prefs: { alert: 0.8 } }, ...(o.models ? { models: o.models } : {}) });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
  return daemon;
}

for (const theme of ['dark', 'light'] as const) test(`a group's + opens the modal: the mockup's grid, the tiles in a row, the 5 h limits, the buttons under the fields; ${theme}`, async ({ page }, info) => {
  await boot(page, { lang: 'fr', theme, models: { claude: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', description: 'contexte 1 M', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', isDefault: true }] } });
  await page.locator('.ide-dock').getByRole('button', { name: 'Nouvelle session (N)' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  const form = dialog.locator('.launch-modal');
  await expect(form).toBeVisible();
  await expect(form.locator('.launch-modal-sub')).toHaveText('S’ouvre dans le groupe actif. Ctrl+Entrée lance, Échap ferme.');
  // 780 px wide, as the mockup's .modal.
  expect(Math.round((await box(dialog)).width)).toBe(780);
  // The grid: labels in a 150 px column, the fields 16 px after it.
  const labels = form.locator('.launch-modal-fld > .launch-modal-lbl');
  const fieldsX = (await box(form.locator('.launch-modal-inp'))).x;
  const labelX = (await box(labels.first())).x;
  expect(Math.round(fieldsX - labelX)).toBe(166);
  for (const l of await labels.all()) expect(Math.round((await box(l)).x)).toBe(Math.round(labelX));
  // Four agent tiles side by side, as wide as each other; Claude's limit amber (84 % over 80 %), Cursor's not read.
  const tiles = form.locator('.launch-modal-agent');
  await expect(tiles).toHaveCount(4);
  const tb = await Promise.all((await tiles.all()).map(box));
  expect(new Set(tb.map(b => Math.round(b.y))).size).toBe(1);
  expect(new Set(tb.map(b => Math.round(b.width))).size).toBe(1);
  await expect(tiles.nth(0)).toContainText(/Limite 5 h 84 % · réinit\. /);
  await expect(tiles.nth(0).locator('b.amber')).toHaveText('84 %');
  await expect(tiles.nth(1).locator('b')).not.toHaveClass(/amber/);
  await expect(tiles.nth(2)).toContainText('Limite non lue');
  // The fields bordered as the mockup's .inp and .agent (app.css's button reset must not win), the Project and Model fields 30 px high.
  const border = (l: Locator) => l.evaluate(e => getComputedStyle(e).borderTopWidth);
  expect(await border(form.locator('.launch-modal-inp'))).toBe('1px');
  expect(await border(tiles.nth(2))).toBe('1px');
  expect(await border(form.locator('.model-trigger'))).toBe('1px');
  expect(Math.round((await box(form.locator('.launch-modal-inp'))).height)).toBe(30);
  expect(Math.round((await box(form.locator('.model-trigger'))).height)).toBe(30);
  // The model wears its provider's logo (the mockup's logo(L.prov)); the effort beside it is exactly as tall, its top aligned.
  await expect(form.locator('.model-trigger .logo')).toHaveAttribute('title', 'Anthropic');
  const trig = await box(form.locator('.model-trigger')), effort = await box(form.locator('.effort-stepper'));
  expect(Math.abs(effort.height - trig.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(effort.y - trig.y)).toBeLessThanOrEqual(1);
  const look = (l: Locator) => l.evaluate(e => { const c = getComputedStyle(e); return [c.borderTopLeftRadius, c.borderTopColor, c.backgroundColor]; });
  expect(await look(form.locator('.effort-stepper'))).toEqual(await look(form.locator('.model-trigger')));
  // The buttons: at the left of the fields' column, Lancer first.
  const go = form.locator('.launch-modal-go');
  expect(Math.round((await box(go)).x)).toBe(Math.round(fieldsX));
  await expect(go.getByRole('button').first()).toHaveText(/^Lancer/);
  // Nothing wider than the form.
  expect(await form.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  // The capture waits for what it shows: the dialog laid out and its fonts loaded.
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await dialog.screenshot({ path: info.outputPath(`ide-launch-${theme}.png`), animations: 'disabled' });
  // The model list: each row wears its provider's logo.
  await form.locator('.model-trigger').click();
  await expect(page.locator('.model-menu .model-option .logo')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`ide-launch-models-${theme}.png`), clip: { ...d0(await box(dialog)) }, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.model-menu')).toBeHidden();
  // The Project menu opens whole, not cut by the modal.
  await form.locator('.launch-modal-inp').click();
  const rows = page.locator('.launch-modal-rows');
  await expect(rows).toBeVisible();
  await expect(rows.getByRole('menuitem')).toHaveCount(2);
  const last = await box(rows.getByRole('menuitem').last());
  const d = await box(dialog);
  expect(last.y + last.height).toBeLessThanOrEqual(d.y + d.height);
  expect(await page.evaluate(() => {
    const m = document.querySelector('.launch-modal-rows')!.getBoundingClientRect();
    const items = [...document.querySelectorAll('.launch-modal-rows [role=menuitem]')];
    return items.every(i => { const r = i.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && i.contains(hit); }) && m.height > 0;
  })).toBe(true);
  await dialog.screenshot({ path: info.outputPath(`ide-launch-menu-${theme}.png`), animations: 'disabled' });
});

test('a long Project menu stays inside the modal, which does not scroll', async ({ page }) => {
  const many: Projects = { rules: [], projects: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `Project ${i + 1}`, color: 'blue' as const, description: '', repos: [{ machine: 'local', path: `/w/p${i}` }] })) };
  await boot(page, { projects: many });
  await page.locator('.ide-dock').getByRole('button', { name: 'New session (N)' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.locator('.launch-modal-inp').click();
  const rows = page.locator('.launch-modal-rows');
  await expect(rows.getByRole('menuitem')).toHaveCount(14);
  const m = await box(rows), d = await box(dialog);
  expect(m.y + m.height).toBeLessThanOrEqual(d.y + d.height);
  expect(await dialog.evaluate(e => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
  // The last row is reached by the menu's own scroll and taken.
  await rows.getByRole('menuitem', { name: /^Project 14/ }).click();
  await expect(dialog.locator('.launch-modal-inp')).toContainText('Project 14');
});

test('a message, Ctrl+Enter: one launch, the modal closes, the new session\'s tab is the active one', async ({ page }) => {
  const daemon = await boot(page);
  await page.locator('.ide-dock').getByRole('button', { name: 'New session (N)' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await expect(dialog).toBeVisible();
  const message = dialog.getByLabel('First message');
  await expect(message).toBeFocused();
  await message.fill('Fix the failing tests');
  await message.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  const sent = launchesOf(daemon.received)[0]!;
  expect(sent).toMatchObject({ cwd: '/w/ledge', prompt: 'Fix the failing tests' });
  await expect(dialog).toBeHidden();
  const tab = tabs(page).filter({ hasText: sent.name! });
  await expect(tab).toHaveCount(1);
  await expect(tab).toHaveClass(/dv-active-tab/);
  expect(launchesOf(daemon.received)).toHaveLength(1);
});

test('N opens the modal; Escape closes it and gives the focus back', async ({ page }) => {
  await boot(page);
  const plus = page.locator('.ide-dock').getByRole('button', { name: 'New session (N)' }).first();
  // The right panel's « Ask Ledge » field does not take the focus by itself: N, straight after the IDE shows, is the shortcut.
  await expect(page.getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask Ledge' })).not.toBeFocused();
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('First message')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // From the group's +, Escape gives the focus back to it.
  await plus.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(plus).toBeFocused();
});

test('the palette\'s « New session » line opens the modal', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+k');
  // The IDE's palette (lot 10).
  const palette = page.getByRole('dialog', { name: 'Palette' });
  await expect(palette).toBeVisible();
  await page.getByRole('combobox', { name: 'Palette' }).fill('new');
  await palette.getByRole('option', { name: /^New session/ }).click();
  await expect(palette).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'New session' }).locator('.launch-modal')).toBeVisible();
});
