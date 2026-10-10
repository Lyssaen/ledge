import { test as base, expect, type Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';

/**
 * Every spec runs the real app in Chromium. The web fonts are answered locally (no network in CI), and every console
 * error or uncaught page error fails the test that produced it.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await use(errors);
    expect(errors, 'no console or page errors').toEqual([]);
  }, { auto: true }]
});
export { expect };

export const surface = (page: Page) => page.locator('[data-surface]');
export const layer = (page: Page, name: string) => page.locator(`[data-layer="${name}"]`);
/** Waits until the surface is in `mode` (the machine's state, mirrored on the element). */
export const expectMode = (page: Page, mode: string) => expect(surface(page)).toHaveAttribute('data-mode', mode);
/** Waits until the fake daemon received a message matching `pred`, and returns it. */
export async function received<T extends ClientMessage['type']>(list: ClientMessage[], type: T, pred: (m: Extract<ClientMessage, { type: T }>) => boolean = () => true) {
  let found: Extract<ClientMessage, { type: T }> | undefined;
  await expect.poll(() => (found = list.find((m): m is Extract<ClientMessage, { type: T }> => m.type === type && pred(m as Extract<ClientMessage, { type: T }>)))).toBeTruthy();
  return found!;
}
/** The app is up and showing the daemon's sessions on the handle. */
export async function ready(page: Page, bots: number) {
  await page.goto('/');
  await expect(layer(page, 'handle').getByRole('button')).toHaveCount(bots);
}
