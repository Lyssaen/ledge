import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

const ratio = (page: import('@playwright/test').Page) => page.evaluate(() =>
  document.querySelector('#conversation-pane')!.getBoundingClientRect().width / document.querySelector('.view-body')!.getBoundingClientRect().width);

test('selecting a seat or a card opens the conversation beside the sessions', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await page.locator('.seat[data-session="local:luna"]').click();
  await expect(pane).toHaveAttribute('data-conversation', 'local:luna');
  await expect(pane).toHaveAttribute('aria-label', 'Conversation with Luna');
  const list = (await page.locator('.view-body > .central').boundingBox())!;
  let box = (await pane.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(list.x + list.width);
  expect(Math.abs(box.y - list.y)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Team' }).click();
  await page.locator('.session-card[data-session="local:milo"]').click();
  await expect(pane).toHaveAttribute('data-conversation', 'local:milo');
  box = (await pane.boundingBox())!;
  expect(box.x).toBeGreaterThan(600);
});

test('the panel is resized from the keyboard and keeps its width across a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  const handle = page.getByRole('separator', { name: 'Conversation width' });
  await handle.focus();
  await expect(handle).toHaveAttribute('aria-valuenow', '38');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '40');
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '70');
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '27');
  expect(await ratio(page)).toBeCloseTo(0.27, 2);
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '27');
  expect(await ratio(page)).toBeCloseTo(0.27, 2);
});

test('Expand hides the sessions until the view changes', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await pane.getByRole('button', { name: '↗ Expand' }).click();
  await expect(page.locator('.view-body > .central')).toBeHidden();
  await expect(page.getByRole('separator')).toHaveCount(0);
  await expect(pane.getByRole('button', { name: '↙ Collapse' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Team' }).click();
  await expect(page.locator('.view-body > .central')).toBeVisible();
  await expect(pane.getByRole('button', { name: '↗ Expand' })).toHaveAttribute('aria-expanded', 'false');
});

test('under 760 px the conversation stacks under the sessions, without a handle', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await fakeDaemon(page, eight);
  await page.goto('/');
  const pane = page.locator('#conversation-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByRole('separator')).toHaveCount(0);
  const list = (await page.locator('.view-body > .central').boundingBox())!;
  const box = (await pane.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
});
