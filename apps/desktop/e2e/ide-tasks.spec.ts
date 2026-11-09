import type { Page } from '@playwright/test';
import type { ClientMessage, HumanAsk, HumanChannel, Session, Task } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Lot 12 (docs/mockups/ledge-ide-tasks-history.html): what only the old interface had. « Tâches » and « Historique » as tabs of the
// right panel's chat, the « Voir » links to a task's detail, and « À toi » completed with what « Le point » showed (Décisions,
// Rigs OpenRig with their card unfolded under its line, Contexte presque plein, the closed tasks of Ledge, « Résumer la journée »).
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const task = (id: string, extra: Partial<Task>): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: iso(3_600_000), updatedAt: iso(3_000_000), log: [{ at: iso(3_600_000), by: 'Ledge', what: 'confiée' }], ...extra });
// Oldest first, as the daemon lists them.
const TASKS: Task[] = [
  task('t-9', { title: 'Migrer la file des toasts vers le nouveau store', owner: 'lu', ownerName: 'Lu', state: 'refused', result: 'Pas dans mon lot.' }),
  task('t-11', { title: 'Passer les captures du lot 10 en clair', giver: 'dev-front', giverName: 'dev-front', owner: 'ida', ownerName: 'Ida' }),
  task('t-12', { title: 'Écrire le test du refus d’un IBAN vide', owner: 'pim', ownerName: 'Pim', state: 'done', text: 'Le test doit échouer d’abord, puis passer avec le refus. Un commit par étape.', result: 'test ajouté, refus en place, 2 commits sur feat/iban.',
    log: [{ at: iso(3_600_000), by: 'Ledge', what: 'confiée à Pim' }, { at: iso(3_500_000), by: 'Pim', what: 'prise' }, { at: iso(600_000), by: 'Pim', what: 'finie' }] }),
  task('t-13', { title: 'Choisir le nom du dossier des captures', giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', text: 'captures/ ou docs/shots/ ? Les deux existent dans ledge-dev.' }),
  task('t-14', { title: 'Relire la PR #231 du lot 9 et dire si elle peut partir', state: 'taken' })
];
const sessions: Session[] = [
  session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', branch: 'feat/lot-9', state: 'idle', context: { used: 164_000, window: 200_000, at: iso(0) } }),
  session('ida', { name: 'Ida', project: 'ledge', cwd: '/w/ledge', branch: 'feat/shots', state: 'working' })
];
const READY: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const ASKS: HumanAsk[] = [{
  id: 'qitem-merge', kind: 'decision', alert: false, priority: 'urgent', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Fusionner le lot 10 maintenant ou attendre la relecture ?', body: 'review-qa a accepté le code mais n’a pas fini les captures.', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q1', question: 'Fusionner ?', options: [{ id: 'now', label: 'Fusionner maintenant', recommended: true }, { id: 'wait', label: 'Attendre la relecture', recommended: false }], answer: null }],
  createdAt: iso(600_000), updatedAt: iso(600_000)
}];
const CHAT = { text: 'Nova attend ta décision sur le nom du dossier des captures.' };

async function boot(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.ide.enabled', 'true'); localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: { version: '0.54.1', install: 'npm', systemd: true, openrigAsks: true } as never, tasks: TASKS, asks: { channel: READY, asks: ASKS }, chat: CHAT });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  return daemon;
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Chat Ledge' });
const rtab = (page: Page, name: RegExp) => panel(page).getByRole('tablist', { name: 'Vues de Ledge' }).getByRole('tab', { name });
const rows = (page: Page) => panel(page).locator('.rt-trow');
const shot = async (page: Page, name: string, el: ReturnType<Page['locator']>) => {
  const b = (await el.boundingBox())!;
  await page.screenshot({ path: `e2e/.results/lot12-${name}.png`, clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
};

for (const theme of ['dark', 'light'] as const) {
  test(`(${theme}) the right panel's tabs: Conversation · Tâches · Historique; a task's detail in place of the list, « ‹ Tâches » and Échap back`, async ({ page }) => {
    await boot(page, theme);
    await expect(rtab(page, /^Conversation$/)).toHaveAttribute('aria-selected', 'true');
    // The open tasks counted: t-11, t-13, t-14.
    await expect(rtab(page, /^Tâches/)).toHaveAccessibleName('Tâches · 3');
    await rtab(page, /^Tâches/).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).first()).toContainText('t-14 · de Ledge à Otto · prise');
    await expect(rows(page).nth(1).locator('.mk')).toHaveText('?');
    await expect(rows(page).nth(1)).toContainText('décision');
    await shot(page, `tasks-list-${theme}`, panel(page));
    // The detail replaces the list.
    await rows(page).filter({ hasText: 't-12' }).click();
    const detail = panel(page).getByRole('region', { name: 'Écrire le test du refus d’un IBAN vide' });
    await expect(detail).toContainText('de Ledge à Pim · finie');
    await expect(detail).toContainText('Résultat : test ajouté');
    await expect(detail.getByRole('listitem')).toHaveCount(3);
    await expect(rows(page)).toHaveCount(0);
    await shot(page, `tasks-detail-${theme}`, panel(page));
    await detail.getByRole('button', { name: '‹ Tâches' }).click();
    await expect(rows(page)).toHaveCount(5);
    // Escape too, the filters kept.
    await panel(page).getByRole('combobox', { name: 'Filtres' }).selectOption('closed');
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasText: 't-12' }).click();
    await expect(detail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rows(page)).toHaveCount(2);
    await expect(panel(page).getByRole('combobox', { name: 'Filtres' })).toHaveValue('closed');
    // A decision awaited: « Répondre » opens the existing answer form.
    await panel(page).getByRole('combobox', { name: 'Filtres' }).selectOption('all');
    await rows(page).filter({ hasText: 't-13' }).click();
    await panel(page).getByRole('button', { name: 'Répondre' }).click();
    await expect(panel(page).getByRole('textbox')).toBeVisible();
    await shot(page, `tasks-decision-${theme}`, panel(page));
  });
}

test('« Voir » of a closed task in the sidebar « À toi »: the right panel, even hidden, on « Tâches » at its detail, the filters back to Toutes / Tous', async ({ page }) => {
  await boot(page);
  await rtab(page, /^Tâches/).click();
  await panel(page).getByRole('combobox', { name: 'Donneur' }).selectOption('sessions');
  await page.keyboard.press('Control+/');
  await expect(panel(page)).toBeHidden();
  await page.getByRole('navigation', { name: /activité/ }).getByRole('button', { name: 'À toi', exact: true }).click();
  const card = page.locator('.st-card[data-task="t-12"]');
  await card.getByRole('button', { name: 'Voir' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(rtab(page, /^Tâches/)).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByRole('region', { name: 'Écrire le test du refus d’un IBAN vide' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('combobox', { name: 'Donneur' })).toHaveValue('all');
  await expect(rows(page)).toHaveCount(5);
});

test('« Historique »: the day\'s questions, the latest first; a click goes back to Conversation on that question, lit a moment', async ({ page }) => {
  const daemon = await boot(page);
  const field = panel(page).getByRole('textbox', { name: 'Demander à Ledge' });
  for (const q of ['Qui a besoin de moi ?', 'Lance une session Codex sur ledge.']) {
    await field.fill(q);
    await field.press('Enter');
    await expect(panel(page).locator('[data-question]').filter({ hasText: q })).toBeVisible();
  }
  await expect.poll(() => daemon.received.filter(m => m.type === 'chat.ask').length).toBe(2);
  await rtab(page, /^Historique$/).click();
  const h = panel(page).locator('.rt-hrow');
  await expect(h).toHaveCount(2);
  await expect(h.first()).toContainText('Lance une session Codex');
  await shot(page, 'history-dark', panel(page));
  await h.nth(1).click();
  await expect(rtab(page, /^Conversation$/)).toHaveAttribute('aria-selected', 'true');
  const q = panel(page).locator('[data-question]').filter({ hasText: 'Qui a besoin de moi ?' });
  await expect(q).toHaveClass(/rt-flash/);
  await expect(q).not.toHaveClass(/rt-flash/, { timeout: 4000 });
});

test('the local daemon goes away: the last list stays, dimmed under its banner; the rows still open, « Répondre » off', async ({ page }) => {
  const daemon = await boot(page);
  await rtab(page, /^Tâches/).click();
  await expect(rows(page)).toHaveCount(5);
  daemon.close();
  await expect(panel(page).locator('.rt-banner')).toHaveText('Daemon local hors ligne : la liste est celle du dernier relevé.');
  await expect(panel(page).locator('.rt-list')).toHaveClass(/dim/);
  await shot(page, 'tasks-offline-dark', panel(page));
  await rows(page).filter({ hasText: 't-13' }).click();
  await expect(panel(page).getByRole('button', { name: 'Répondre' })).toBeDisabled();
});

for (const theme of ['dark', 'light'] as const) {
  test(`(${theme}) « À toi »: Décisions, Rigs OpenRig, Contexte presque plein, the closed tasks of Ledge, « Résumer la journée »`, async ({ page }) => {
    const daemon = await boot(page, theme);
    await page.getByRole('navigation', { name: /activité/ }).getByRole('button', { name: 'À toi', exact: true }).click();
    await page.getByRole('button', { name: 'Page', exact: true }).click();
    const tab = page.getByRole('tabpanel', { name: /^À toi/ });
    const block = (name: string) => tab.locator(`[data-block="${name}"]`);
    // Order: Demandes · Décisions · Rigs OpenRig · MR et PR · Contexte presque plein · Terminé.
    await expect(tab.locator('.fg-blk-h b')).toHaveText(['Demandes', 'Décisions', 'Rigs OpenRig', 'MR et PR', 'Contexte presque plein', 'Terminé depuis ton passage']);
    await expect(block('decisions')).toContainText('Nova Choisir le nom du dossier des captures');
    await expect(block('rigs').locator('.atoi-line')).toContainText('urgentdécision');
    await expect(block('near')).toContainText('Otto · contexte 82 %');
    const fin = tab.locator('.fg-blk').last();
    await expect(fin.locator('[data-task="t-12"]')).toContainText('Pim a fini « Écrire le test du refus d’un IBAN vide » · tâche de Ledge');
    await expect(fin.locator('[data-task="t-9"]')).toContainText('Lu a refusé');
    await page.screenshot({ path: `e2e/.results/lot12-atoi-${theme}.png` });
    // « Ouvrir » unfolds the rig's card under its line; « Replier » folds it.
    await block('rigs').getByRole('button', { name: 'Ouvrir' }).click();
    await expect(block('rigs').locator('.atoi-askc .ask-card')).toBeVisible();
    await expect(block('rigs').locator('.atoi-askc')).toContainText('Fusionner maintenant');
    await shot(page, `atoi-rigask-${theme}`, block('rigs'));
    await block('rigs').getByRole('button', { name: 'Replier' }).click();
    await expect(block('rigs').locator('.atoi-askc')).toHaveCount(0);
    // « Voir » of a closed task: the right panel at its detail.
    await fin.locator('[data-task="t-12"]').getByRole('button', { name: 'Voir' }).click();
    await expect(panel(page).getByRole('region', { name: 'Écrire le test du refus d’un IBAN vide' })).toBeVisible();
    // « Résumer la journée »: the question asked in the chat, on Conversation.
    await tab.getByRole('button', { name: 'Résumer la journée' }).click();
    await expect(rtab(page, /^Conversation$/)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => daemon.received.filter((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask').map(m => m.text)).toEqual(['Résume la journée : ce qui a avancé, ce qui attend ma décision, ce qui bloque.']);
  });
}

test('« Voir » of a rig\'s request in the sidebar: the page « À toi », its card unfolded and ringed a moment', async ({ page }) => {
  await boot(page);
  await page.getByRole('navigation', { name: /activité/ }).getByRole('button', { name: 'À toi', exact: true }).click();
  await page.locator('.st-rig-ask[data-ask="qitem-merge"]').getByRole('button', { name: 'Voir' }).click();
  const tab = page.getByRole('tabpanel', { name: /^À toi/ });
  const card = tab.locator('[data-ask="qitem-merge"] .atoi-askc');
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/lit/);
  await shot(page, 'atoi-rigask-see-dark', tab.locator('[data-block="rigs"]'));
  await expect(card).not.toHaveClass(/lit/, { timeout: 4000 });
});

// Review of lot 12 (review-qa2, P2): a hidden right panel is unmounted; the question waits for it and goes once it is there.
test('« Résumer la journée » with the right panel hidden (Ctrl+/): the panel comes back on Conversation and the question goes, once', async ({ page }) => {
  const daemon = await boot(page);
  await expect(panel(page)).toBeVisible();
  await page.locator('body').click({ position: { x: 900, y: 500 } });
  await page.keyboard.press('Control+/');
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('navigation', { name: /activité/ }).getByRole('button', { name: 'À toi', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await page.getByRole('tabpanel', { name: /^À toi/ }).getByRole('button', { name: 'Résumer la journée' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(rtab(page, /^Conversation$/)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => daemon.received.filter(m => m.type === 'chat.ask').length).toBe(1);
  // Hidden and shown again: nothing is asked twice.
  await page.keyboard.press('Control+/');
  await page.keyboard.press('Control+/');
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(daemon.received.filter(m => m.type === 'chat.ask')).toHaveLength(1);
});

// Review of lot 12 (review-qa2, R1): the card brought by « Voir » is taken in once; reopening the page does not unfold it again.
test('after a sidebar « Voir », « À toi » closed and opened again: the card stays folded; a new « Voir » unfolds it again', async ({ page }) => {
  await boot(page);
  await page.getByRole('navigation', { name: /activité/ }).getByRole('button', { name: 'À toi', exact: true }).click();
  const see = page.locator('.st-rig-ask[data-ask="qitem-merge"]').getByRole('button', { name: 'Voir' });
  await see.click();
  const tab = page.getByRole('tabpanel', { name: /^À toi/ });
  const card = tab.locator('[data-ask="qitem-merge"] .atoi-askc');
  await expect(card).toBeVisible();
  await tab.locator('[data-ask="qitem-merge"]').getByRole('button', { name: 'Replier' }).click();
  await expect(card).toHaveCount(0);
  await page.locator('.dv-tab', { hasText: 'À toi' }).getByRole('button', { name: /Fermer/ }).click();
  await expect(tab).toHaveCount(0);
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await expect(tab.locator('[data-block="rigs"]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card).toHaveCount(0);
  await see.click();
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/lit/);
});

// Review of lot 12 (review-qa2, second reading): each « Résumer la journée » is a new question, the panel open all along.
test('« Résumer la journée » twice, the right panel open all along: two questions go', async ({ page }) => {
  const daemon = await boot(page);
  await page.getByRole('navigation', { name: /activité/ }).getByRole('button', { name: 'À toi', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const summarize = page.getByRole('tabpanel', { name: /^À toi/ }).getByRole('button', { name: 'Résumer la journée' });
  await summarize.click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'chat.ask').length).toBe(1);
  await expect(panel(page).locator('[data-question]')).toHaveCount(1);
  // The fake daemon answers at once: the second question is not refused as « busy ».
  await expect(summarize).toBeEnabled();
  await summarize.click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'chat.ask').length).toBe(2);
});
