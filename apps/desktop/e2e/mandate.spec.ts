import type { Page } from '@playwright/test';
import type { BrainStatus, ClientMessage, Escalation, LedgeDecision, LedgeRule, LedgeThreadItem, OpenRigStatus, Rig, RigSeat } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { DEFAULT_MANDATE, ROUTING, fakeDaemon, session, twoProjects } from './daemon';

// Lot 7, the brain of Ledge: the Mandat tab (maquette p-ledge-mandat), the grace of an escalation, « Tranché aujourd'hui » and the offer.
// In French: the labels are the plan's, word for word.

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Of<T> => m.type === type);

const AT = new Date(Date.now() - 20 * 60_000).toISOString();
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.3.0' };
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const FACTORY: Rig = { id: 'r-factory', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('build'), seat('orch-lead', { state: 'idle' })] };
const otto = session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const ON: BrainStatus = { state: 'on', tool: 'claude', enabled: true, sessionId: 'brain' };

const MERGE = 'Merge, jamais de rebase sur une branche partagée';
const PROPOSED = 'Supprimer la branche locale une fois mergée → oui';
const RULES: LedgeRule[] = [
  { id: 'r1', text: MERGE, category: 'git', since: '2026-10-20T09:00:00.000Z', from: 'd0', appliedCount: 4, status: 'active' },
  { id: 'r2', text: PROPOSED, category: 'git', since: '2026-10-30T09:00:00.000Z', from: 'd2,d3', appliedCount: 0, status: 'proposed' }
];
/** The escalation Ledge settled today: merge feat/sqlite into main, by rule r1. */
const SETTLED: Escalation = { id: 'q-git', source: 'rig', machine: 'local', rigId: 'r-factory', from: 'build@factory', intent: 'decision', category: 'git',
  summary: 'Merge ou rebase de feat/sqlite sur main ?', createdAt: AT, state: 'answered',
  questions: [{ id: 'how', question: 'Merge ou rebase de feat/sqlite sur main ?', options: [{ id: 'merge', label: 'Merge', recommended: true }, { id: 'rebase', label: 'Rebase' }] }],
  answer: { by: 'ledge', answers: { how: 'merge' }, at: AT, rule: 'r1' } };
const DECISION: LedgeDecision = { id: 'd1', escalationId: 'q-git', by: 'ledge', category: 'git', summary: 'merge de feat/sqlite dans main', answers: { how: 'merge' },
  rule: 'r1', from: 'build@factory', rigId: 'r-factory', at: AT };
const SETTLED_ITEMS: LedgeThreadItem[] = [{ kind: 'escalation', id: 't-q-git', at: AT, escalationId: 'q-git' }, { kind: 'decided', id: 't-d1', at: AT, decisionId: 'd1' }];

const thread = (page: Page) => page.getByRole('log', { name: 'Fil de Ledge' });

async function boot(page: Page, tab?: 'Mandat') {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'fr'); } catch { /* ignore */ } });
  await page.goto('/');
  await page.locator('section.ledge-home').waitFor();
  if (tab) await page.locator('.home-tabs').getByRole('tab', { name: tab }).click();
}

test('the Mandat tab matches the mockup', async ({ page }) => {
  await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], escalations: [SETTLED],
    brain: { status: ON, mandate: DEFAULT_MANDATE, rules: RULES, decisions: [DECISION] } });
  await boot(page, 'Mandat');
  const tab = page.getByRole('tabpanel', { name: 'Mandat' });
  await expect(tab.getByRole('tab', { name: 'Ce que Ledge tranche' })).toHaveAttribute('aria-selected', 'true');
  await expect(tab.getByRole('tab', { name: 'Souvenirs · 2' })).toBeVisible();
  await expect(tab).toContainText('Mandat lu dans ~/.ledge/mandat.md');
  const self = tab.getByRole('listbox', { name: 'LEDGE TRANCHE SEUL' });
  await expect(self.getByRole('option')).toHaveText([/Git et branches/, /Tests et relectures/, /Contexte et relèves/, /Petits choix de code/]);
  await expect(self.getByRole('option', { name: /Git et branches/ })).toHaveAttribute('aria-selected', 'true');
  await expect(self.getByRole('option', { name: /Git et branches/ })).toContainText('1 cette semaine');
  await expect(tab.getByRole('listbox', { name: 'TE REVIENT TOUJOURS' }).getByRole('option')).toHaveText([/Design/, /Architecture/, /Critique/]);
  const detail = tab.getByRole('region', { name: 'Catégorie Git et branches' });
  await expect(detail).toContainText('Ledge tranche seul · 1 décision cette semaine · mandat');
  await expect(detail.getByRole('button', { name: 'Me le remonter désormais' })).toBeVisible();
  const rules = detail.getByRole('table', { name: 'Règles retenues' });
  await expect(rules.getByRole('columnheader')).toHaveText(['Règle', 'Depuis', "D'où elle vient", 'Appliquée']);
  await expect(rules.getByRole('row').filter({ hasText: MERGE })).toContainText('20/10');
  await expect(rules.getByRole('row').filter({ hasText: MERGE })).toContainText('4 fois');
  const proposed = rules.getByRole('row').filter({ hasText: PROPOSED });
  await expect(proposed).toContainText('proposée');
  await expect(proposed).toContainText('tu as tranché deux fois pareil');
  await expect(proposed.getByRole('button', { name: 'à valider' })).toBeVisible();
  await expect(detail).toContainText("bleu : une règle que Ledge propose ; elle ne s'applique qu'une fois validée.");
  const last = detail.getByRole('list', { name: 'Dernières décisions' });
  await expect(last).toContainText('build@factory merge de feat/sqlite dans main');
  await expect(last).toContainText('règle du 20/10');
  await expect(last.getByRole('button', { name: 'Revenir dessus' })).toBeEnabled();
  await expect(detail).toContainText("Ledge propose une règle quand tu tranches deux fois pareil. Le design, l'architecture et le critique ne passent jamais dans « Ledge tranche seul ».");
});

test('escalating git moves it to TE REVIENT TOUJOURS', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY],
    brain: { status: ON, mandate: DEFAULT_MANDATE, rules: RULES, decisions: [DECISION] } });
  await boot(page, 'Mandat');
  const tab = page.getByRole('tabpanel', { name: 'Mandat' });
  await tab.getByRole('button', { name: 'Me le remonter désormais' }).click();
  await expect(tab.getByRole('listbox', { name: 'TE REVIENT TOUJOURS' }).getByRole('option', { name: /Git et branches/ })).toBeVisible();
  await expect(tab.getByRole('listbox', { name: 'LEDGE TRANCHE SEUL' }).getByRole('option', { name: /Git et branches/ })).toHaveCount(0);
  expect(sent(daemon.received, 'category.escalate')).toEqual([expect.objectContaining({ category: 'git' })]);
  const detail = tab.getByRole('region', { name: 'Catégorie Git et branches' });
  await expect(detail).toContainText('Te revient toujours · 0 en attente · mandat');
  await expect(detail.getByRole('button', { name: 'Me le remonter désormais' })).toHaveCount(0);
  // The proposed rule is validated from « à valider »: the fake daemon serves it active, the rules come back.
  await detail.getByRole('button', { name: 'à valider' }).click();
  await page.getByRole('menuitem', { name: 'Valider' }).click();
  expect(sent(daemon.received, 'rule.set')).toEqual([expect.objectContaining({ id: 'r2', status: 'active' })]);
  await expect(detail.getByRole('button', { name: 'à valider' })).toHaveCount(0);
});

test('a grace escalation shows « Ledge s\'en occupe… » and the user can still answer', async ({ page }) => {
  const grace: Escalation = { id: 'q-grace', source: 'rig', machine: 'local', rigId: 'r-factory', from: 'orch-lead@factory', intent: 'decision', category: 'tests',
    summary: 'Relancer toute la suite ou seulement les tests ciblés ?', createdAt: new Date().toISOString(), state: 'grace', graceUntil: new Date(Date.now() + 60_000).toISOString(),
    questions: [{ id: 'which', question: 'Relancer toute la suite ou seulement les tests ciblés ?', options: [{ id: 'targeted', label: 'Les ciblés', recommended: true }, { id: 'all', label: 'Toute la suite' }] }] };
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], escalations: [grace],
    thread: [{ kind: 'escalation', id: 't-q-grace', at: grace.createdAt, escalationId: 'q-grace' }],
    brain: { status: ON, mandate: DEFAULT_MANDATE, rules: RULES, decisions: [] } });
  await boot(page);
  const card = thread(page).locator('[data-escalation-card="q-grace"]');
  await expect(card).toContainText("Ledge s'en occupe…");
  await card.getByRole('button', { name: 'Toute la suite' }).click();
  await expect(card).toContainText('Répondu par toi : Toute la suite');
  await expect(card).not.toContainText("Ledge s'en occupe…");
  expect(sent(daemon.received, 'escalation.answer')).toEqual([expect.objectContaining({ id: 'q-grace', answers: { which: 'all' }, by: 'user' })]);
});

test('Tranché aujourd\'hui lists Ledge\'s decision and « Revenir » brings the card back', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], escalations: [SETTLED], thread: SETTLED_ITEMS,
    brain: { status: ON, mandate: DEFAULT_MANDATE, rules: RULES, decisions: [DECISION] } });
  await boot(page);
  await expect(thread(page)).toContainText("J'ai tranché pour build : merge de feat/sqlite dans main");
  await expect(thread(page)).toContainText('Règle du 20/10');
  const rail = page.getByRole('complementary', { name: 'Rail de Ledge' });
  // At 1280 px the rail is the compact line « À toi · 0 · Rigs · 1 »: opened, it shows its sections.
  const toggle = rail.getByRole('button', { name: /^À toi · \d+ · Rigs/ });
  if (await toggle.isVisible()) await toggle.click();
  const today = rail.getByRole('region', { name: "Tranché aujourd'hui · 1" });
  await expect(today).toContainText('merge de feat/sqlite dans main');
  await today.getByRole('button', { name: 'Revenir' }).click();
  expect(sent(daemon.received, 'decision.revisit')).toEqual([expect.objectContaining({ id: 'd1' })]);
  // The card comes back, open, with its buttons; answering it corrects the decision.
  const back = thread(page).locator('[data-escalation-card="q-git"]').last();
  await expect(back.getByRole('button', { name: 'Rebase' })).toBeVisible();
  await back.getByRole('button', { name: 'Rebase' }).click();
  await expect(back).toContainText('Répondu par toi : Rebase');
  // The corrected decision is marked revisited: in the Mandat tab it can no longer be revisited.
  await page.locator('.home-tabs').getByRole('tab', { name: 'Mandat' }).click();
  const old = page.getByRole('list', { name: 'Dernières décisions' }).locator('[data-decision="d1"]');
  await expect(old.getByRole('button', { name: 'Revenir dessus' })).toBeDisabled();
});

test('the offer activates the brain', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: RUNNING, rigs: [FACTORY], daemon: { ...ROUTING, openrig: true },
    brain: { status: { state: 'off', tool: 'claude', enabled: null }, mandate: DEFAULT_MANDATE, rules: [], decisions: [] } });
  await boot(page);
  const offer = page.getByRole('group', { name: /^Je peux penser en continu/ });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Activer' }).click();
  await expect(offer).toHaveCount(0);
  expect(sent(daemon.received, 'brain.set')).toEqual([expect.objectContaining({ enabled: true, first: true })]);
  await expect(thread(page)).toContainText('Je pense en continu désormais');
  // Réglages › Ledge: the switch is on, the brain runs.
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Sections des réglages' }).getByRole('button', { name: /^Ledge/ }).click();
  await expect(page.getByRole('switch', { name: 'Ledge pense en continu' })).toBeChecked();
  await expect(page.locator('[data-brain-status]')).toHaveText('En marche');
  // A reload does not offer it again: the daemon remembers the answer.
  await page.reload();
  await page.locator('section.ledge-home').waitFor();
  await expect(page.getByRole('tabpanel', { name: 'Conversation' })).toBeVisible();
  await expect(offer).toHaveCount(0);
});
