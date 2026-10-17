import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const otto = () => [session('otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', source: 'hook' } })];

test.describe('French by default', () => {
  test.use({ lang: null });

  test('the ask card and the chat menu read French, and settings leave for Ledge Desktop', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ledge.dnd', '1'));
    await fakeDaemon(page, otto());
    await ready(page, 1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.keyboard.press('Control+Alt+L');
    await expectMode(page, 'bubble');
    const bubble = layer(page, 'bubble');
    await expect(bubble.getByText('Otto attend votre accord')).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Refuser' })).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Autoriser' })).toBeVisible();
    await expect(bubble.getByRole('button', { name: /^Plus tard/ })).toBeVisible();
    await expect(bubble.getByRole('button', { name: /Ouvrir dans Ledge/ })).toBeVisible();
    await page.keyboard.press('Control+Alt+L');
    await expectMode(page, 'chat');
    await expect(layer(page, 'chat').getByRole('button', { name: 'Retour aux sessions' })).toHaveCount(0);
    await layer(page, 'chat').getByRole('button', { name: 'Menu de Ledge' }).click();
    await layer(page, 'chat').getByRole('button', { name: /Réglages dans Ledge Desktop/ }).click();
    await expect(page.getByRole('status')).toContainText('Ouverture des réglages dans Ledge Desktop');
    await expect(layer(page, 'chat').getByRole('button', { name: 'Menu de Ledge' })).toHaveAttribute('aria-expanded', 'false');
  });
});
