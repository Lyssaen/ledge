import { test as base, expect } from '@playwright/test';

/** Every spec runs in English (stored before the app boots) and any console or page error fails the test (spec §12). */
export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    expect(errors, 'no console or page errors').toEqual([]);
  }, { auto: true }]
});
export { expect };
