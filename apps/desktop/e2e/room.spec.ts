import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

test('the room groups the eight agents and keeps its grouping across a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await expect(page.locator('.table-group')).toHaveCount(1);
  await expect(page.locator('.table-group')).toHaveAttribute('data-participants', '8');
  await expect(page.locator('.view-heading p')).toHaveText('2 requests waiting');
  await page.locator('#table-grouping').selectOption('jira');
  await expect(page.locator('.table-group')).toHaveCount(3);
  await expect.poll(() => page.locator('.table-group').evaluateAll(els => els.map(e => e.getAttribute('data-table')))).toEqual(['LEDGE-42', 'WEB-18', 'unassigned']);
  await page.locator('#table-grouping').selectOption('machine');
  await expect(page.locator('.table-group')).toHaveCount(1);
  await expect(page.locator('.table-group')).toHaveAttribute('data-table', 'local');
  await page.locator('#table-grouping').selectOption('jira');
  await page.locator('.seat', { hasText: 'Luna' }).click();
  await expect(page.locator('.seat', { hasText: 'Luna' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#table-grouping')).toHaveValue('jira');
  await expect(page.locator('.table-group')).toHaveCount(3);
});
