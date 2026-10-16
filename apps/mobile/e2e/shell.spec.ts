import { expect, test } from '@playwright/test';
import { fakeDaemon, session } from './daemon';

for (const width of [320, 390, 430]) {
  test(`the shell fits the width and uses local fonts only (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const foreign: string[] = [];
    page.on('request', r => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url())) foreign.push(r.url()); });
    await fakeDaemon(page, [session('s1')]);
    await page.goto('/m/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    expect(foreign).toEqual([]);
    expect(await page.evaluate(() => document.fonts.check("14px 'Geist Variable'"))).toBe(true);
  });
}
