import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { LedgeDecision, LedgeRule } from '@ledge/protocol';
import { DEFAULT_MANDATE, fakeDaemon, twoProjects, type ChatReply, openAtelier } from './daemon';
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
  await page.goto('/'); await openAtelier(page);
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

/** The Mandat tab (lot 7, maquette p-ledge-mandat): two git rules (one proposed, « à valider »), Ledge's decisions of the week. */
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const mandateRules: LedgeRule[] = [
  { id: 'r1', text: 'Merge, jamais de rebase sur une branche partagée', category: 'git', since: '2026-10-26T09:00:00.000Z', from: 'd9', appliedCount: 4, status: 'active' },
  { id: 'r2', text: 'Fusion sur main seulement après la relecture d’un second agent', category: 'git', since: '2026-10-30T09:00:00.000Z', from: 'd2,d3', appliedCount: 0, status: 'proposed' },
  { id: 'r3', text: 'Tests ciblés d’abord, la suite entière avant la PR', category: 'tests', since: '2026-10-20T09:00:00.000Z', from: '', appliedCount: 6, status: 'active' }
];
const mandateDecisions: LedgeDecision[] = [
  { id: 'd1', escalationId: 'e1', by: 'ledge', category: 'git', summary: 'merge de feat/sqlite dans main, pas de rebase', answers: {}, rule: 'r1', from: 'build@factory', rigId: 'rf', at: ago(25) },
  { id: 'd2', escalationId: 'e2', by: 'user', category: 'git', summary: 'relecture avant la fusion', answers: {}, from: 'orch-lead@factory', rigId: 'rf', at: ago(80) },
  { id: 'd3', escalationId: 'e3', by: 'user', category: 'git', summary: 'relecture avant la fusion de fix/ssh', answers: {}, from: 'dev-build@starter', rigId: 'rs', at: ago(60 * 26) },
  { id: 'd9', escalationId: 'e9', by: 'ledge', category: 'git', summary: 'force-push refusé', answers: {}, from: 'build@factory', rigId: 'rf', at: ago(60 * 24 * 4) }
];

for (const theme of ['dark', 'light'] as const) {
  test(`mandat, ${theme}`, async ({ page }) => {
    await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
    await fakeDaemon(page, busy, { projects: twoProjects, openrig: { machine: 'local', state: 'running', version: '0.3.0' },
      brain: { status: { state: 'on', tool: 'claude', enabled: true }, mandate: DEFAULT_MANDATE, rules: mandateRules, decisions: mandateDecisions } });
    await page.goto('/');
    await page.locator('section.ledge-home').waitFor();
    await page.locator('.home-tabs').getByRole('tab', { name: 'Mandat' }).click();
    await expect(page.getByRole('region', { name: 'Catégorie Git et branches' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SCREENS}desktop-mandat-${theme}.png` });
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
  await page.keyboard.press('Control+/');
  const field = page.getByRole('complementary').getByRole('textbox').first();
  await expect(field).toBeFocused();
  await field.fill('Qui a besoin de moi ?');
  await field.press('Enter');
  await expect(page.getByRole('complementary').getByText('Les autres travaillent.', { exact: false })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}desktop-chat-dark.png` });
});
