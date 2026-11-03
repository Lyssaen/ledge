import { test, expect } from '@playwright/test';
import type { HumanAsk, HumanChannel } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

// « À toi », lot 1 (docs/mockups/ledge-human-operator-ab-lot1.html): the sidebar's « Voir » brings the card into view from any home tab.
const NOW = new Date().toISOString();
const ASK: HumanAsk = {
  id: 'qitem-1', kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Écran de réglage : un modèle pour tout ?', body: 'Lu prépare Réglages › Ledge.', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q', question: 'Un modèle ?', options: [{ id: 'one', label: 'Un seul modèle', recommended: true }], answer: null }], createdAt: NOW, updatedAt: NOW
};
const READY: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };

for (const tab of ['Tâches', 'Historique'] as const) {
  test(`« Voir » from the home’s ${tab} tab opens the conversation and focuses the card (review P1)`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); } catch { /* ignore */ } });
    await fakeDaemon(page, [session('bix', { name: 'Bix', rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev', role: 'pilot.lead' } })],
      { daemon: { version: '0.36.0', install: 'npm', systemd: true, openrigAsks: true }, asks: { channel: READY, asks: [ASK] } });
    await page.goto('/');
    const home = page.getByRole('region', { name: 'Accueil : Ledge, l’opérateur' });
    await home.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await expect(page.locator('article[data-ask="qitem-1"]')).toHaveCount(0);
    await page.locator('.st-rig-ask[data-ask="qitem-1"]').getByRole('button', { name: 'Voir' }).click();
    const card = page.locator('article[data-ask="qitem-1"]');
    await expect(card).toBeVisible();
    await expect(card).toBeFocused();
    await expect(home.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
  });
}
