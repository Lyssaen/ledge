import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

// The app is the window's content, not the mockup's framed study page: it fills any window size.
for (const size of [{ width: 1920, height: 1080 }, { width: 1024, height: 700 }]) {
  test(`the app fills a ${size.width}×${size.height} window`, async ({ page }) => {
    await page.setViewportSize(size);
    await fakeDaemon(page, eight);
    await page.goto('/');
    await expect(page.locator('.table-group').first()).toBeVisible();
    for (const view of ['Meeting', 'Team']) {
      await page.getByRole('button', { name: view }).click();
      const app = await page.locator('main.app').boundingBox();
      expect(app).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
      const bar = await page.locator('.statusbar').boundingBox();
      expect(bar!.y + bar!.height).toBe(size.height);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    }
  });

  test(`a lone table sits in the middle of a ${size.width}×${size.height} room`, async ({ page }) => {
    await page.setViewportSize(size);
    await fakeDaemon(page, eight);
    await page.goto('/');
    await page.getByRole('button', { name: 'Meeting' }).click();
    const area = (await page.locator('.table-groups').boundingBox())!;
    const table = (await page.locator('.table-group').first().boundingBox())!;
    expect(Math.abs(table.x + table.width / 2 - (area.x + area.width / 2))).toBeLessThan(6);
  });
}
