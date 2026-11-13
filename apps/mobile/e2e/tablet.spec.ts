// An iPad, either way up: the tabs are a rail on the left, the list stays on the left and what it opens shows beside it
// (docs/mockups/mobile-multi-device.html, part 5). Narrower (Split View), the phone's single column comes back.
// SHOTS=<dir> saves a capture of each screen there.
import { devices, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _webkit, ...iPad } = devices['iPad Pro 11 landscape'];
test.use(iPad);
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');

let h: Harness;
test.beforeAll(async () => { h = await startHarness(); });
test.afterAll(async () => { await h?.close(); });

async function shot(page: Page, name: string, browser: string) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${browser}-tablet-${name}.png` });
}

test('on an iPad the list and the request sit side by side, either way up', async ({ page, browserName }) => {
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  // The app without a key opens on the choice (passkey-reinstall.html, 1 a): the code.
  await page.getByRole('button', { name: copy.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
  const row = page.getByRole('link', { name: /pnpm test/ });
  await expect(row).toBeVisible();

  // Nothing chosen yet: the right pane says what will open there.
  await expect(page.getByRole('heading', { name: copy.split.request.title })).toBeVisible();
  const nav = page.getByRole('navigation', { name: copy.nav.label });
  expect.soft((await nav.boundingBox())!.x).toBe(0);
  await shot(page, 'inbox', browserName);

  await row.click();
  const allow = page.getByRole('button', { name: copy.decide.allow });
  await expect(allow).toBeEnabled();
  // The list stays, the chosen row marked, the request on its right; no « Retour » to a list that is already there.
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'page');
  expect.soft((await allow.boundingBox())!.x).toBeGreaterThan((await row.boundingBox())!.x + (await row.boundingBox())!.width);
  await expect(page.getByRole('link', { name: copy.nav.backTo.atoi! })).toBeHidden();
  await shot(page, 'request', browserName);

  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(row).toBeVisible();
  await expect(allow).toBeVisible();
  await shot(page, 'request-portrait', browserName);

  // Split View: a phone's width, a phone's column.
  await page.setViewportSize({ width: 420, height: 1194 });
  await expect(row).toBeHidden();
  await expect(allow).toBeVisible();
  await shot(page, 'request-narrow', browserName);

  // The agents: nothing chosen, then a thread beside them.
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.getByRole('navigation', { name: copy.nav.label }).getByRole('link', { name: copy.nav.sessions }).click();
  await expect(page.getByRole('heading', { name: copy.split.agent.title })).toBeVisible();
  const agent = page.locator('.split-list main a[href^="#/thread/"]').first();
  await agent.click();
  await expect(agent).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.split-detail header')).toBeVisible();
  await shot(page, 'thread', browserName);

  // « À toi » from the keyboard (m1-a-toi.html §12): the tab comes back on the request it was left on; ↓ stays on the only one,
  // Y allows it, its receipt shows, then the pane moves on; with none left, « Choisis une demande ».
  await page.getByRole('navigation', { name: copy.nav.label }).getByRole('link', { name: copy.nav.atoi }).click();
  await page.keyboard.press('ArrowDown');
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(copy.atoi.keys)).toBeVisible();
  await shot(page, 'request-keys', browserName);
  await page.keyboard.press('y');
  await expect(page.getByText(copy.result.allowed)).toBeVisible();
  await expect.poll(() => h.daemon.typed.length).toBe(1);
  await expect(page.getByRole('heading', { name: copy.split.request.title })).toBeVisible({ timeout: 10_000 });
});

// The Ledge pane (m3-chat.html §7, Q36): the rail's button opens 400 px on the right over any tab; on its side the tablet makes
// room for it (the list keeps 380 px), upright it goes over the detail; only its buttons close it, and the device keeps it.
test('the Ledge pane opens from the rail, beside the panes on its side, over the detail upright', async ({ page, browserName }) => {
  // Its own PC: the file's one is already paired with the first test's page.
  const h = await startHarness();
  h.daemon.chat = true;
  try {
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    await page.getByRole('button', { name: copy.recover.code }).click();
    await h.pc.code();
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    const rail = page.getByRole('navigation', { name: copy.nav.label });
    await rail.getByRole('link', { name: copy.nav.sessions }).click();
    const ledge = rail.getByRole('button', { name: copy.nav.chat });
    await ledge.click();
    await expect(ledge).toHaveAttribute('aria-pressed', 'true');
    await expect(rail.getByRole('link', { name: copy.nav.sessions })).toHaveAttribute('aria-current', 'page');
    const pane = page.getByRole('complementary', { name: copy.chat.title });
    await expect(pane.getByLabel(copy.chat.field)).toBeVisible();
    await expect(page).toHaveURL(/#\/sessions$/);

    // On its side: the pane beside the two panes, the list still 380 px, the detail ending where the pane starts.
    const width = page.viewportSize()!.width;
    const box = (await pane.boundingBox())!;
    expect.soft(box.width).toBe(400);
    expect.soft(box.x + box.width).toBe(width);
    const list = (await page.locator('.split-list').boundingBox())!;
    expect.soft(list.width).toBe(380);
    const split = (await page.locator('.split').boundingBox())!;
    expect.soft(split.x + split.width).toBeLessThanOrEqual(box.x + 1);
    await shot(page, 'ledge-pane', browserName);

    // A tap outside does not close it; upright it goes over the detail, the list keeping its 330 px.
    await page.locator('.split-detail').click({ position: { x: 20, y: 200 } });
    await expect(pane).toBeVisible();
    await page.setViewportSize({ width: 834, height: 1194 });
    const upright = (await pane.boundingBox())!;
    expect.soft(upright.x + upright.width).toBe(834);
    const under = (await page.locator('.split').boundingBox())!;
    expect.soft(under.x + under.width).toBeGreaterThan(upright.x + 300);
    expect.soft((await page.locator('.split-list').boundingBox())!.width).toBe(330);
    await shot(page, 'ledge-pane-portrait', browserName);

    // Kept on the device; « Fermer le volet » closes it.
    await page.reload();
    await expect(pane).toBeVisible();
    await pane.getByRole('button', { name: copy.chat.pane.close }).click();
    await expect(pane).toBeHidden();
    await expect(ledge).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await h.close();
  }
});

// Sessions upright (t-tablette.html §2, §3; Q92 A, Q93 A): the thread keeps the list beside it with the phone's foot; the terminal
// folds the list and takes the whole width, and « Retour » reopens it.
test('upright, the thread keeps the list beside it and the terminal folds it', async ({ page, browserName }) => {
  // Its own PC: the file's one is already paired with the first test's page.
  const h = await startHarness();
  try {
    await page.setViewportSize({ width: 834, height: 1194 });
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    await page.getByRole('button', { name: copy.recover.code }).click();
    await h.pc.code();
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    await page.getByRole('navigation', { name: copy.nav.label }).getByRole('link', { name: copy.nav.sessions }).click();
    await page.locator('.split-list main a[href^="#/thread/"]').first().click();
    const list = page.locator('.split-list');
    await expect(list).toBeVisible();
    expect.soft((await list.boundingBox())!.width).toBe(330);
    // The thread's pane keeps 18 px on each side, as §2 draws it (review-qa 6873dfab).
    const pad = await page.locator('.split-detail').evaluate(e => [getComputedStyle(e).paddingLeft, getComputedStyle(e).paddingRight]);
    expect.soft(pad).toEqual(['18px', '18px']);
    await shot(page, 'thread-portrait', browserName);

    await page.locator('.split-detail').getByRole('link', { name: copy.sessions.view.terminal }).click();
    await expect(list).toBeHidden();
    const detail = (await page.locator('.split-detail').boundingBox())!;
    expect.soft(detail.x).toBe(76);
    expect.soft(detail.width).toBe(834 - 76);
    await shot(page, 'terminal-portrait', browserName);

    await page.locator('.split-detail [data-back]').first().click();
    await expect(list).toBeVisible();
  } finally {
    await h.close();
  }
});
