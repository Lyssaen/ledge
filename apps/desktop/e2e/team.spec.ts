import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

test('eight agents: team grid, filter and selection survive a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await page.getByRole('button', { name: 'Team' }).click();
  await expect(page.locator('.session-card')).toHaveCount(8);
  await expect(page.locator('.toolbar')).toHaveText('Whole team · 8');
  await expect(page.locator('.section-label')).toHaveText(['ledge', 'website']);
  await page.locator('#attention').click();
  await expect(page.locator('.session-card')).toHaveCount(2);
  await page.locator('.session-card', { hasText: 'Luna' }).click();
  await page.reload();
  await expect(page.locator('#attention')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.session-card[aria-pressed="true"]')).toHaveText(/Luna/);
});

test('no session: the empty workspace', async ({ page }) => {
  await fakeDaemon(page, []);
  await page.goto('/');
  // the default view is the meeting room: the empty workspace replaces it too
  await expect(page.getByRole('button', { name: 'Meeting' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Your team starts here')).toBeVisible();
  await expect(page.locator('.table-group')).toHaveCount(0);
  await page.getByRole('button', { name: 'Team' }).click();
  await expect(page.getByText('Your team starts here')).toBeVisible();
});
