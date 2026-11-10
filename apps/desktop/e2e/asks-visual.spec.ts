import type { Page } from '@playwright/test';
import type { HumanAsk, HumanChannel, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session } from './daemon';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// Visual review of the rigs' requests, lot 1 (docs/mockups/ledge-human-operator-ab-lot1.html), in the IDE: the old home's column is
// the page « À toi »'s « Rigs OpenRig » block (docs/mockups/ledge-ide-tasks-history.html), each card unfolded by « Ouvrir »; the
// sidebar's is the « À toi » view.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/asks-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture « À toi »');
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const NOW = new Date(Date.now() - 4 * 60_000).toISOString();
const seat = (id: string, name: string, role: string): Session =>
  session(id, { name, cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge-dev`, state: 'idle', rig: { seat: `${role.replace('.', '-')}@ledge-dev`, name: 'ledge-dev', role } });
const SEATS = [seat('bix', 'Bix', 'pilot.lead'), seat('lu', 'Lu', 'design.ux'), seat('ida', 'Ida', 'dev.front'), seat('pim', 'Pim', 'review.qa')];
const from = (role: string) => ({ seat: `${role.replace('.', '-')}@ledge-dev`, rig: 'ledge-dev', role });
const base = { alert: false, priority: 'routine' as const, bodyTruncated: false, detail: null, evidenceRef: null, createdAt: NOW, updatedAt: NOW };
const ASKS: HumanAsk[] = [
  { ...base, id: 'qitem-urgent', kind: 'decision', priority: 'urgent', from: from('review.qa'), summary: 'La revue bloque la fusion : on corrige avant ou après la démo ?', body: '',
    questions: [{ id: 'q', question: 'Quand ?', options: [{ id: 'before', label: 'Avant', recommended: true }, { id: 'after', label: 'Après', recommended: false }], answer: null }] },
  { ...base, id: 'qitem-192556', kind: 'decision', from: from('pilot.lead'), summary: 'Écran de réglage : un modèle pour tout, ou un plus fort pour « décider seul » ?',
    body: 'Lu prépare Réglages › Ledge pour le lot 4. Le choix change ce que l’écran propose et le coût de Ledge : un seul modèle est plus simple à régler, deux modèles permettent un modèle plus fort, et plus lent, seulement quand Ledge décide seul. La note de vision n’en prévoit qu’un.',
    detail: 'Les deux options ont été maquettées.', evidenceRef: 'docs/mockups/ledge-human-operator-ab.html',
    questions: [{ id: 'q', question: 'Un modèle ?', options: [{ id: 'one', label: 'Un seul modèle', recommended: true }, { id: 'two', label: 'Un plus fort pour décider seul', recommended: false }], answer: null }] },
  { ...base, id: 'qitem-two', kind: 'decision', from: from('pilot.lead'), summary: 'Deux choix pour l’écran de réglage', body: '',
    questions: [
      { id: 'q1', question: 'Un modèle pour tout, ou un plus fort pour décider seul ?', options: [{ id: 'one', label: 'Un seul modèle', recommended: false }, { id: 'two', label: 'Deux', recommended: false }], answer: { kind: 'option', id: 'one' } },
      { id: 'q2', question: 'Délai avant envoi par défaut ?', options: [{ id: '3', label: '3 s', recommended: false }, { id: '5', label: '5 s', recommended: true }, { id: '10', label: '10 s', recommended: false }], answer: null }
    ] },
  { ...base, id: 'qitem-parked', kind: 'parked', from: from('dev.front'), summary: 'Je reste bloquée sur la carte « Pas envoyée » : je garde la carte ou je la remplace ?',
    body: 'La ligne qitem-…195555 attend une décision de toi depuis 12 minutes. Ida ne peut pas continuer le lot 1 sans elle.', questions: [] },
  { ...base, id: 'qitem-news', kind: 'update', from: from('design.ux'), summary: 'Maquette A+B : complément harnais et modèle rendu',
    body: 'Slack retiré, Réglages › Ledge avec harnais et modèle, écran « harnais pas installé ».', evidenceRef: 'docs/mockups/ledge-human-operator-ab.html', questions: [] }
];
const READY: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };

async function open(page: Page, o: { theme: 'dark' | 'light'; lang?: 'fr' | 'en'; asks?: HumanAsk[]; channel?: HumanChannel; answered?: Record<string, unknown> }) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [o.theme, o.lang ?? 'fr']);
  await fakeDaemon(page, SEATS, { daemon: { version: '0.36.0', install: 'npm', systemd: true, openrigAsks: true }, asks: { channel: o.channel ?? READY, asks: o.asks ?? ASKS, ...(o.answered ? { answered: o.answered } : {}) } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('navigation', { name: /activité|Activity/ }).getByRole('button', { name: o.lang === 'en' ? 'For you' : 'À toi', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
}
/** The page « À toi », in its tab. */
const col = (page: Page) => page.getByRole('tabpanel', { name: /^(À toi|For you)/ });
/** A request's line on the page, its card unfolded under it (« Ouvrir »). */
async function card(page: Page, id: string) {
  const line = col(page).locator(`.atoi-ask[data-ask="${id}"]`);
  const open = line.getByRole('button', { name: /^(Ouvrir|Open)$/ });
  if (await open.count()) await open.click();
  return line;
}

for (const theme of ['dark', 'light'] as const) {
  test(`À toi, ${theme}`, async ({ page }, info) => {
    await open(page, { theme });
    await expect(col(page).locator('[data-block="rigs"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`home-${theme}.png`) });
    await col(page).locator('[data-block="rigs"]').screenshot({ path: info.outputPath(`column-${theme}.png`) });
    await page.locator('.ide-explorer').screenshot({ path: info.outputPath(`sidebar-yours-${theme}.png`) });
    for (const [id, n] of [['qitem-192556', 'decision'], ['qitem-two', 'two'], ['qitem-parked', 'parked'], ['qitem-news', 'news'], ['qitem-urgent', 'urgent']] as const) {
      await (await card(page, id)).screenshot({ path: info.outputPath(`card-${n}-${theme}.png`) });
    }
    // « Répondre autrement… » open.
    const one = await card(page, 'qitem-192556');
    await one.getByRole('button', { name: 'Répondre autrement…' }).click();
    await one.screenshot({ path: info.outputPath(`card-compose-${theme}.png`) });
  });

  test(`not sent, then sent, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, asks: [ASKS[1]!], answered: { ok: false, outcome: undefined, error: 'openrig_stopped' } });
    const one = await card(page, 'qitem-192556');
    await one.getByRole('button', { name: 'Un plus fort pour décider seul' }).click();
    await expect(one.getByRole('alert')).toHaveText(/Pas envoyée : OpenRig est arrêté/);
    await one.screenshot({ path: info.outputPath(`card-failed-${theme}.png`) });
  });

  test(`sent line, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, asks: [ASKS[1]!] });
    await (await card(page, 'qitem-192556')).getByRole('button', { name: 'Un seul modèle · recommandé' }).click();
    await expect(page.locator('.ask-done')).toHaveText(/Envoyé à Bix · pilot/);
    await page.locator('.ask-done').screenshot({ path: info.outputPath(`done-${theme}.png`) });
  });

  test(`uncertain and words on several questions, ${theme}`, async ({ page }, info) => {
    await open(page, { theme, asks: [ASKS[1]!, ASKS[2]!], answered: { ok: false, outcome: undefined, error: 'uncertain' } });
    const one = await card(page, 'qitem-192556');
    await one.getByRole('button', { name: 'Un plus fort pour décider seul' }).click();
    await expect(one.getByRole('alert')).toHaveText(/Envoi incertain/);
    await one.screenshot({ path: info.outputPath(`card-uncertain-${theme}.png`) });
    const two = await card(page, 'qitem-two');
    await two.getByRole('button', { name: 'Répondre autrement…' }).click();
    await expect(two.getByText(/règle toute la demande/)).toBeVisible();
    await two.screenshot({ path: info.outputPath(`card-two-words-${theme}.png`) });
  });

  for (const state of ['no_person', 'no_default', 'openrig_stopped', 'unreachable', 'not_installed'] as const) {
    test(`banner ${state}, ${theme}`, async ({ page }, info) => {
      const message = state === 'unreachable' ? 'connection refused on 127.0.0.1:7433' : state === 'no_default' ? 'rig human default <address>' : undefined;
      await open(page, { theme, asks: [], channel: { state, person: null, slack: false, ...(message ? { message } : {}) } });
      await expect(page.locator('.ask-banner')).toBeVisible();
      await page.locator('.ask-banner').screenshot({ path: info.outputPath(`banner-${state}-${theme}.png`) });
    });
  }
}

test('english', async ({ page }, info) => {
  await open(page, { theme: 'dark', lang: 'en' });
  await expect(col(page).locator('[data-block="rigs"]')).toBeVisible();
  await col(page).locator('[data-block="rigs"]').screenshot({ path: info.outputPath('column-en-dark.png') });
});
