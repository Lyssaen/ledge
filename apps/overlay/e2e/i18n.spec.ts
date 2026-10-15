import { test, expect, layer, expectMode, ready, surface } from './fixtures';
import { fakeDaemon } from './daemon';
import { overview, openList, restInside } from './scenarios';

test.describe('French by default', () => {
  test.use({ lang: null });

  test('the list, the badges and a permission read the mockup\'s French labels', async ({ page }) => {
    await fakeDaemon(page, overview());
    await ready(page, 4);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await openList(page);
    const list = layer(page, 'list');
    await expect(list.getByText('4 sessions · 2 demandes pour vous')).toBeVisible();
    for (const name of ['Ne pas déranger', 'Réglages', 'Replier']) await expect(list.getByRole('button', { name, exact: true }).first()).toBeVisible();
    for (const word of ['Votre accord', 'Une question', 'Au travail', 'Disponible']) await expect(list.getByText(word, { exact: true })).toBeVisible();
    await expect(list.locator('[data-row]', { hasText: /Otto\s*·\s*Cette machine\s*·\s*18 min/ }).first()).toBeVisible();
    await expect(list.locator('kbd', { hasText: 'Ctrl Alt L' })).toBeVisible();
    await list.getByRole('button', { name: 'harness-assistant, Otto, ouvrir' }).click();
    await expectMode(page, 'session');
    await restInside(page);
    const view = layer(page, 'session');
    await expect(view.getByText('À vous de jouer')).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Otto souhaite lancer une commande.' })).toBeVisible();
    await expect(view.getByText('Exécution dans harness-assistant')).toBeVisible();
    await expect(view.getByRole('checkbox', { name: 'Toujours pour cette session' })).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Refuser' })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Autoriser' })).toBeVisible();
    await expect(view.getByPlaceholder('Une instruction pour votre compagnon…')).toBeVisible();
  });

  test('a question reads "Envoyer la réponse →" and "Ou proposez autre chose…"', async ({ page }) => {
    await fakeDaemon(page, overview());
    await ready(page, 4);
    await openList(page);
    await layer(page, 'list').getByRole('button', { name: 'design-system, Nova, ouvrir' }).click();
    await expectMode(page, 'session');
    const view = layer(page, 'session');
    await expect(view.getByText('Une question', { exact: true })).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Quel thème utiliser par défaut ?' })).toBeVisible();
    await expect(view.getByRole('radio', { name: 'Sombre · Signal' })).toBeChecked();
    await expect(view.getByPlaceholder('Ou proposez autre chose…')).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Envoyer la réponse →' })).toBeEnabled();
  });
});

test.describe('Language setting', () => {
  test.use({ lang: null });

  test('switching to English in Settings applies live, is remembered, and switching back restores French', async ({ page }) => {
    await fakeDaemon(page, overview());
    await ready(page, 4);
    await openList(page);
    await layer(page, 'list').getByRole('button', { name: 'Réglages' }).click();
    await expectMode(page, 'settings');
    const settings = layer(page, 'settings');
    await expect(settings.getByText('Votre Ledge')).toBeVisible();
    await expect(settings.getByRole('radio', { name: 'Français' })).toBeChecked();
    await settings.getByText('English', { exact: true }).click();
    await expect(settings.getByText('Your Ledge')).toBeVisible();
    await expect(settings.getByRole('radio', { name: 'English' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => localStorage.getItem('ledge.lang'))).toBe('en');
    await settings.getByRole('button', { name: 'Back to sessions' }).click();
    await expectMode(page, 'list');
    await expect(layer(page, 'list').getByText('4 sessions · 2 waiting for you')).toBeVisible();
    await expect(layer(page, 'list').getByText('Running', { exact: true })).toBeVisible();
    await expect(layer(page, 'list').locator('[data-row]', { hasText: /Otto\s*·\s*This machine\s*·\s*18m/ }).first()).toBeVisible();
    // Remembered across a reload.
    await page.reload();
    await expect(layer(page, 'handle').getByRole('button', { name: /^Otto needs your approval, open/ })).toBeAttached();
    await openList(page);
    await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
    await layer(page, 'settings').getByText('Français', { exact: true }).click();
    await expect(layer(page, 'settings').getByText('Votre Ledge')).toBeVisible();
    await expect(surface(page)).toHaveAttribute('data-mode', 'settings');
  });
});
