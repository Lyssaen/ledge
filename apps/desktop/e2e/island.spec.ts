import type { Page } from '@playwright/test';
import { DEFAULT_ISLAND_PREFS, type ClientMessage, type IslandPrefs } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
const tab = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}( |$)`) });
const heading = (page: Page) => page.locator('.settings-head h1');
const sw = (page: Page, name: string) => page.getByRole('switch', { name });
const group = (page: Page, name: string) => page.getByRole('radiogroup', { name });
/** A segmented option: its label is what is clicked (the radio itself is hidden under it, as in the mockup). */
const option = (page: Page, groupName: string, name: string) => group(page, groupName).locator('label').filter({ hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) });
const recorder = (page: Page) => page.getByRole('button', { name: /^Shortcut to open the notch: / });
const caption = (page: Page) => page.locator('.island-preview figcaption > span');
const footerState = (page: Page) => page.getByRole('contentinfo').locator('.overlay-state');
const said = (page: Page) => page.evaluate(() => [...((window as unknown as { __ledgeToasts?: string[] }).__ledgeToasts ?? [])]);
const savedSaid = async (page: Page) => (await said(page)).filter(t => t.startsWith('Setting saved'));
type IslandSet = Extract<ClientMessage, { type: 'island.set' }>;
const setsOf = (received: ClientMessage[]) => received.filter((m): m is IslandSet => m.type === 'island.set');

/** The overview is up, then the footer's island state opens Settings › Notch. */
async function openIsland(page: Page) {
  await expect(page.locator('aside.sidebar').getByText(/\d+ active/).first()).toBeVisible();
  await expect(footerState(page)).toHaveText('Notch active');
  await footerState(page).click();
  await expect(heading(page)).toHaveText('Notch');
}

test('Settings › Notch: every control sends island.set with the whole settings, « Setting saved » once the daemon broadcasts, the preview follows', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await openIsland(page);
  await expect(tab(page, 'Notch')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('note')).toContainText('The notch has no settings of its own any more.');
  await expect(page.locator('.preview-caption')).toHaveText(['Main 2560 × 1440', 'Screen 2 1920 × 1080']);
  await expect(page.locator('.preview-screen.here .preview-notch.pos-center')).toBeVisible();
  await expect(page.locator('.preview-bubble')).toHaveText('Otto needs your approval');
  await expect(group(page, 'Notch size').getByRole('radio', { name: 'Auto (125%)' })).toBeChecked();
  await expect(group(page, 'Notch windows size').getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();

  const expectLast = async (count: number, prefs: Partial<IslandPrefs>, notice: string) => {
    await expect.poll(() => setsOf(daemon.received).length).toBe(count);
    expect(setsOf(daemon.received).at(-1)!.prefs).toMatchObject(prefs);
    await expect(page.locator('.toast', { hasText: notice })).toBeVisible();
  };

  // Position: the notch moves to the right quarter of the main screen.
  await option(page, 'Notch position', 'Right').click();
  await expectLast(1, { position: 'right' }, 'Setting saved · Position: Right');
  await expect(page.locator('.preview-notch')).toHaveClass(/pos-right/);
  await expect(page.locator('.preview-bubble')).toHaveClass(/pos-right/);
  // Screen: the notch goes to the second screen, the hint gives its size, Auto reads it.
  await option(page, 'Screen', 'Screen 2').click();
  await expectLast(2, { screen: '#1', position: 'right' }, 'Setting saved · Screen 2');
  await expect(page.locator('.preview-screen.here .preview-caption')).toHaveText('Screen 2 1920 × 1080');
  await expect(page.getByText('The notch sits at the top of this screen (1920 × 1080).')).toBeVisible();
  await expect(group(page, 'Notch size').getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();
  // Discreet: under a simulated maximised window the notch is a line; off, it stays whole.
  await page.getByRole('button', { name: 'Simulate a maximised window' }).click();
  await expect(page.locator('.preview-notch')).toHaveClass(/strip/);
  await expect(page.locator('.preview-bubble')).toHaveCount(0);
  await expect(caption(page)).toHaveText('Discreet mode: a simple line under the maximised window.');
  await sw(page, 'Discreet under a window').click();
  await expectLast(3, { discreet: false }, 'Setting saved · Notch always whole');
  await expect(page.locator('.preview-notch')).not.toHaveClass(/strip/);
  await expect(caption(page)).toHaveText('Discreet mode off: the notch stays whole above the window.');
  await page.getByRole('button', { name: 'Remove the window' }).click();
  await expect(page.locator('.preview-window')).toHaveCount(0);
  // Sizes.
  await option(page, 'Notch size', '150%').click();
  await expectLast(4, { islandScale: 1.5 }, 'Setting saved · Notch size 150%');
  await expect(page.locator('.preview-notch')).toHaveAttribute('style', /--k: ?1\.5/);
  await option(page, 'Notch windows size', '200%').click();
  await expectLast(5, { panelScale: 2 }, 'Setting saved · Windows size 200%');
  // What the notch does: the words' bubble leaves the preview.
  await sw(page, 'Agents’ words').click();
  await expectLast(6, { shows: { quick: true, finished: true, say: false, helpers: true } }, 'Setting saved · Words hidden');
  await expect(page.locator('.preview-bubble')).toHaveCount(0);
  await sw(page, 'Allow and answer from the notch').click();
  await expectLast(7, { shows: { quick: false, finished: true, say: false, helpers: true } }, 'Setting saved · Answers in Ledge Desktop only');
  await sw(page, 'Bubble when an agent is done').click();
  await expectLast(8, { shows: { quick: false, finished: false, say: false, helpers: true } }, 'Setting saved · No task finished bubble');
  await sw(page, 'Subagents in the notch').click();
  await expectLast(9, { shows: { quick: false, finished: false, say: false, helpers: false } }, 'Setting saved · Subagents hidden');
  // Each change is said once, and the whole settings went each time.
  await expect.poll(async () => (await savedSaid(page)).length).toBe(9);
  expect(setsOf(daemon.received).at(-1)!.prefs).toEqual({
    ...DEFAULT_ISLAND_PREFS, screen: '#1', position: 'right', discreet: false, islandScale: 1.5, panelScale: 2, shows: { quick: false, finished: false, say: false, helpers: false }
  });
});

test('« Show the notch » off: everything else is disabled, the preview is empty, the footer says « Notch hidden » and opens the section again', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await openIsland(page);
  await sw(page, 'Show the notch').click();
  await expect(page.locator('.toast', { hasText: 'Setting saved · Notch hidden' })).toBeVisible();
  expect(setsOf(daemon.received).map(m => m.prefs)).toEqual([{ ...DEFAULT_ISLAND_PREFS, visible: false }]);
  await expect(sw(page, 'Show the notch')).toHaveAttribute('aria-checked', 'false');
  await expect(sw(page, 'Show the notch')).toBeEnabled();
  for (const name of ['Discreet under a window', 'Allow and answer from the notch', 'Bubble when an agent is done', 'Agents’ words', 'Subagents in the notch']) await expect(sw(page, name)).toBeDisabled();
  for (const name of ['Screen', 'Notch position', 'Notch size', 'Notch windows size']) {
    await expect(group(page, name)).toHaveAttribute('aria-disabled', 'true');
    for (const r of await group(page, name).getByRole('radio').all()) await expect(r).toBeDisabled();
  }
  await expect(recorder(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Simulate a maximised window' })).toBeDisabled();
  await expect(page.locator('.preview-notch')).toHaveCount(0);
  await expect(page.locator('.preview-screen.here')).toHaveCount(0);
  await expect(caption(page)).toHaveText('The notch is hidden. Ledge Desktop still lets you know.');
  // The footer, back on the overview.
  await page.keyboard.press('Escape');
  await expect(nav(page)).toHaveCount(0);
  await expect(footerState(page)).toHaveText('Notch hidden');
  await expect(footerState(page)).toHaveClass(/off/);
  await footerState(page).click();
  await expect(heading(page)).toHaveText('Notch');
  await expect(sw(page, 'Show the notch')).toHaveAttribute('aria-checked', 'false');
  // Kept by the daemon: a reload still says it.
  await page.goto('/');
  await expect(footerState(page)).toHaveText('Notch hidden');
});

test('the shortcut recorder: Edit, a key without Ctrl, Alt or ⊞ is refused, Escape cancels in place, Ctrl Alt K is sent and shown in Keyboard shortcuts', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await openIsland(page);
  await expect(recorder(page)).toHaveText('Ctrl Alt LEdit');
  await recorder(page).click();
  await expect(recorder(page)).toHaveText('Press…Cancel');
  await expect(recorder(page)).toHaveClass(/recording/);
  await expect(page.getByText('Press the combination you want. Esc to cancel.')).toBeVisible();
  await page.keyboard.press('k');
  await expect(page.locator('.toast', { hasText: 'Add Ctrl, Alt or ⊞: the shortcut has to work anywhere in Windows.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(recorder(page)).toHaveText('Ctrl Alt LEdit');
  await expect(heading(page)).toHaveText('Notch');
  expect(setsOf(daemon.received)).toHaveLength(0);
  await recorder(page).click();
  await page.keyboard.press('Control+Alt+K');
  await expect(page.locator('.toast', { hasText: 'Setting saved · Open the notch: Ctrl Alt K' })).toBeVisible();
  expect(setsOf(daemon.received).map(m => m.prefs.shortcut)).toEqual(['Ctrl Alt K']);
  await expect(recorder(page)).toHaveText('Ctrl Alt KEdit');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Keyboard shortcuts: the notch's row shows it, and its « Edit » comes back here.
  await tab(page, 'Keyboard shortcuts').click();
  const row = page.locator('.set-row', { hasText: 'Open the notch’s list' });
  await expect(row.locator('kbd')).toHaveText('Ctrl Alt K');
  await row.getByRole('button', { name: 'Edit the notch’s shortcut' }).click();
  await expect(heading(page)).toHaveText('Notch');
});

test('a daemon too old for the notch: no footer state, the section says so and a change is refused under its row', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects, island: 'unknown' });
  await page.goto('/');
  await expect(page.locator('aside.sidebar').getByText(/\d+ active/).first()).toBeVisible();
  await expect(footerState(page)).toHaveCount(0);
  await page.keyboard.press('Control+Comma');
  await tab(page, 'Notch').click();
  await expect(page.locator('.set-well[role=status]')).toHaveText('The local daemon is too old for the notch’s settings: update it.');
  await sw(page, 'Agents’ words').click();
  await expect(page.getByRole('alert')).toHaveText('The local daemon is too old for the notch’s settings: update it.');
  expect(setsOf(daemon.received)).toHaveLength(0);
});

test('a 520 × 700 window: Settings › Notch fits without a side scroll, the two screens stacked', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 700 });
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  // The footer keeps the notch's state at this width; it opens the section.
  await expect(footerState(page)).toHaveText('Notch active');
  await expect(footerState(page)).toBeInViewport();
  await footerState(page).click();
  await expect(heading(page)).toHaveText('Notch');
  await page.getByRole('button', { name: 'Simulate a maximised window' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'the page does not scroll sideways').toBe(true);
  expect(await page.locator('.settings-scroll').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'the settings do not scroll sideways').toBe(true);
  await expect(page.locator('.preview-desk')).toHaveCSS('flex-direction', 'column');
  const right = (await page.locator('.settings-scroll').boundingBox())!;
  for (const card of await page.locator('.set-card').all()) {
    const b = (await card.boundingBox())!;
    expect(b.x + b.width, 'each card fits').toBeLessThanOrEqual(right.x + right.width + 1);
  }
});
