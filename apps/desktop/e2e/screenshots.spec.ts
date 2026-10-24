import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { fakeDaemon, twoProjects, type ChatReply } from './daemon';
import { fleet, ottoThread } from './thread';

// Captures Ledge Desktop for docs/screens (README, tour), in French, against the simulated daemon.
// Skipped unless asked: LEDGE_SCREENSHOTS=1 pnpm --filter desktop exec playwright test e2e/screenshots.spec.ts
const SCREENS = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
test.skip(!process.env.LEDGE_SCREENSHOTS, 'set LEDGE_SCREENSHOTS=1 to refresh docs/screens');
// LEDGE_CHROMIUM=/path/to/chrome when the Playwright build pinned by the project is not installed.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', ...(process.env.LEDGE_CHROMIUM ? { launchOptions: { executablePath: process.env.LEDGE_CHROMIUM } } : {}) });

/** The session fixtures with a topic each, Nova with two helpers: a busy afternoon on two projects. */
const topics: Record<string, string> = {
  otto: 'Câbler la liste des sessions', nova: 'Reconnexion ssh du fleet', pim: 'Mouvement des mascottes', bix: 'Documenter le protocole',
  echo: 'Tests des notifications', luna: 'Nouvelle page d\'accueil', milo: 'Mise en page mobile', rio: 'Accessibilité du site'
};
const busy = fleet.map(s => ({
  ...s, topic: topics[s.id] ?? s.project, title: `${s.name} · ${topics[s.id] ?? s.project}`,
  ...(s.id === 'nova' ? { helpers: [{ id: 'n1', kind: 'Explore', task: 'Relire le protocole', state: 'working' as const }, { id: 'n2', kind: 'general-purpose', task: 'Lancer les tests ssh', state: 'working' as const }] } : {})
}));

async function boot(page: Page, theme: 'dark' | 'light', chat?: ChatReply) {
  await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  const daemon = await fakeDaemon(page, busy, { projects: twoProjects, threads: { otto: ottoThread }, ...(chat ? { chat } : {}) });
  await page.goto('/');
  await expect(page.locator('.agent-seat').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return daemon;
}

for (const theme of ['dark', 'light'] as const) {
  test(`atelier, ${theme}`, async ({ page }) => {
    const daemon = await boot(page, theme);
    const otto = busy.find(s => s.id === 'otto')!;
    daemon.upsert({ ...otto, lastMessage: { id: 'sent-1', to: 'Nova', peer: 'nova', summary: 'Les tests de l\'overlay passent', at: new Date().toISOString() } });
    await expect(page.locator('.exchange-wire path')).toHaveCount(1);
    await page.screenshot({ path: `${SCREENS}desktop-atelier-${theme}.png` });
  });

  test(`session, ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.getByRole('tree').getByRole('button', { name: /^Otto/ }).click();
    await expect(page.locator('.session-thread .turn').first()).toBeVisible();
    await page.screenshot({ path: `${SCREENS}desktop-session-${theme}.png` });
  });
}

test('launch, dark', async ({ page }) => {
  await boot(page, 'dark');
  await page.keyboard.press('n');
  const form = page.getByRole('dialog');
  await expect(form).toBeVisible();
  await form.getByRole('textbox').first().fill('Ajoute un test pour la reconnexion ssh du fleet');
  await page.screenshot({ path: `${SCREENS}desktop-launch-dark.png` });
});

test('chat, dark', async ({ page }) => {
  const chat: ChatReply = {
    steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'otto', name: 'Otto' }, { kind: 'pane', id: 'luna', name: 'Luna' }],
    text: '**Otto** attend ton accord pour lancer `npm test` sur ledge. **Luna** te demande quel port utiliser pour la homepage. Les autres travaillent.\n\nJe peux démarrer une session pour corriger les tests qui échouent.',
    proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Corrige les tests de l\'overlay qui échouent' }
  };
  await boot(page, 'dark', chat);
  await page.keyboard.press('/');
  const field = page.locator('aside.sidebar').getByRole('textbox').first();
  await expect(field).toBeFocused();
  await field.fill('Qui a besoin de moi ?');
  await field.press('Enter');
  await expect(page.getByRole('complementary').getByText('Les autres travaillent.', { exact: false })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}desktop-chat-dark.png` });
});
