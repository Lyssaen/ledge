import { expect, type Page } from '@playwright/test';

// What the specs rewritten for the IDE (lot 12a) share: the IDE is up, a session opened from the explorer into its tab.

/** The IDE has booted on the seeded atelier (seedAtelier) and the explorer shows the Projects view. */
export async function ideReady(page: Page): Promise<void> {
  // A Vite cold start (the run's first page) can keep `.ide` aria-busy past the default 5 s.
  await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
}

/** A dock tab by its label's start (a session's name, « Atelier », « Settings »). */
export const tabOf = (page: Page, name: string) =>
  page.locator('.ide-dockview .dv-tab').filter({ has: page.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });

/** A tab's content, by the tab's label. */
export const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });

/** Opens a session from the explorer's Projects view and waits for its page in its tab (the chunk loads on the first visit). */
export async function openSession(page: Page, name: string): Promise<void> {
  const button = page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'Projects', exact: true });
  if (!(await button.getAttribute('class'))?.includes('on')) await button.click();
  await page.locator('.ide-explorer').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
  await expect(pane(page, name).locator('.session-page')).toBeVisible({ timeout: 20_000 });
}
