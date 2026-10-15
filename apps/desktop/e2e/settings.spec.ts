import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';

const LOCAL = { id: 'local', label: 'Local' };
const DEVBOX = { id: 'devbox', label: 'Devbox', ssh: 'devbox' };

test('adding a machine: the daemon brings it back into the list, its sessions show, and it survives a reload', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })]);
  await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'working' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(1);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: '＋ Add a machine', exact: true }).click();
  await page.getByRole('textbox', { name: 'Machine name', exact: true }).fill('Devbox');
  await page.getByRole('textbox', { name: 'SSH alias', exact: true }).fill('devbox');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const card = page.getByRole('article', { name: 'Devbox', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Connected');
  await expect(page.getByRole('textbox', { name: 'Machine name', exact: true })).toHaveCount(0);
  const sets = local.received.filter(m => m.type === 'machines.set');
  expect(sets).toHaveLength(1);
  expect(sets[0]).toMatchObject({ machines: [LOCAL, { label: 'Devbox', ssh: 'devbox' }] });

  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();

  // The list lives in the daemon, not in the page.
  await page.reload();
  await expect(page.locator('.seat')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Devbox', exact: true })).toContainText('Connected');
});

test('a disconnected machine’s notice opens Settings › Machines, and Back returns to the notice', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })], { machines: [LOCAL, DEVBOX] });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'working' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(2);
  remote.close();
  await page.getByRole('button', { name: 'Machine settings', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('article', { name: 'Devbox', exact: true })).toContainText('Disconnected');
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Machine settings', exact: true })).toBeFocused();
});

for (const size of [{ width: 1280, height: 520 }, { width: 520, height: 700 }]) {
  test(`the settings screen fills a ${size.width}×${size.height} window and scrolls inside its panel`, async ({ page }) => {
    await page.setViewportSize(size);
    await fakeDaemon(page, eight);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    const bar = (await page.locator('.statusbar').boundingBox())!;
    expect(bar.y + bar.height).toBe(size.height);
    const panel = page.locator('.settings-panel');
    const { scroll, client } = await panel.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(scroll).toBeGreaterThan(client);
    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole('switch', { name: 'Reduced motion', exact: true })).toBeInViewport();
  });
}
