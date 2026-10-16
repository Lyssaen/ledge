import { expect, test, type Page } from '@playwright/test';
import type { Session, Turn } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const idle = (extra: Partial<Session> = {}): Session => session('bix', { name: 'Bix', topic: 'Recherche de sessions', repo: 'harness-assistant', repoPath: '/r/h', branch: 'session-search', state: 'idle', unread: true, ...extra });
const TURNS: Turn[] = [
  { id: 't1', kind: 'prompt', at: ago(9), text: 'Ajoute une recherche dans la liste des sessions.', source: 'pc' },
  { id: 't2', kind: 'decision', at: ago(7), decision: 'accept', source: 'phone', pendingId: 'p0' },
  { id: 't3', kind: 'reply', at: ago(4), text: '**La recherche de sessions est prête.**\n\n- Recherche par titre et dépôt\n- Conservation du filtre au retour\n\n## Suite\n\nJe peux te montrer le diff avant de préparer la fusion.' }
];
const sends = (received: unknown[], type: string) => received.filter((m): m is Record<string, unknown> => (m as { type?: string }).type === type);

async function open(page: Page, s: Session = idle(), turns: Turn[] = TURNS) {
  await page.addInitScript(() => localStorage.setItem('ledge.mobile.token', 't'.repeat(43)));
  const d = await fakeDaemon(page, [s]);
  d.onMessage(m => { if (m.type === 'session.history') d.send({ type: 'session.turns', id: m.id, turns }); });
  return d;
}

for (const width of [320, 390, 430]) {
  test(`the thread shows turns, events and a suggestion without action (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    await page.goto('/m/#/thread/bix');
    await expect(page.getByRole('heading', { level: 1, name: 'Recherche de sessions' })).toBeVisible();
    await expect(page.getByText('Ajoute une recherche dans la liste des sessions.')).toBeVisible();
    await expect(page.getByText('Accord pris en compte · depuis le téléphone')).toBeVisible();
    await expect(page.getByText('La recherche de sessions est prête.')).toBeVisible();
    await expect(page.getByText('Suggestion pour la suite')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    await expect(page.getByText('Disponible pour votre consigne')).toBeVisible();
    for (const q of ['Montre le diff', 'Lance les tests', 'Explique les changements']) await expect(page.getByRole('button', { name: q })).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    const small = await page.evaluate(() => [...document.querySelectorAll('a, button')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && (r.width < 44 || r.height < 44)).length);
    expect(small).toBe(0);
    await page.screenshot({ path: `e2e/shots/thread-${width}.png` });
  });
}

test('the composer stays in view on a 568 px-high screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await page.goto('/m/#/thread/bix');
  const box = await page.getByLabel('Message pour Bix').boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(568);
  await expect(page.getByRole('button', { name: 'Envoyer à Bix' })).toBeInViewport();
  await page.screenshot({ path: 'e2e/shots/thread-320x568.png' });
});

test('opening the thread clears the unread mark', async ({ page }) => {
  const d = await open(page);
  await page.goto('/m/#/thread/bix');
  await expect.poll(() => sends(d.received, 'session.history').length).toBeGreaterThan(0);
  await expect.poll(() => sends(d.received, 'session.read').length).toBe(1);
  expect(sends(d.received, 'session.read')[0]).toMatchObject({ id: 'bix', at: TURNS[2]!.at });
});

test('a session update asks for the thread again', async ({ page }) => {
  const d = await open(page);
  await page.goto('/m/#/thread/bix');
  await expect.poll(() => sends(d.received, 'session.history').length).toBe(1);
  d.upsert(idle({ lastActivityAt: ago(0) }));
  await expect.poll(() => sends(d.received, 'session.history').length).toBe(2);
});

test('quick reply fills the draft without sending', async ({ page }) => {
  const d = await open(page);
  await page.goto('/m/#/thread/bix');
  await page.getByRole('button', { name: 'Lance les tests' }).click();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
  await page.waitForTimeout(300);
  expect(sends(d.received, 'session.reply')).toHaveLength(0);
  await page.reload();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
});

test('send to an idle agent: taken by the terminal, draft cleared', async ({ page }) => {
  const d = await open(page);
  d.onMessage(m => {
    if (m.type === 'session.history') d.send({ type: 'session.turns', id: m.id, turns: TURNS });
    if (m.type === 'session.reply') { d.send({ type: 'operation.received', operationId: m.operationId }); setTimeout(() => d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' }), 300); }
  });
  await page.goto('/m/#/thread/bix');
  await page.getByLabel('Message pour Bix').fill('Lance les tests');
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect(page.getByText('Envoi au PC…').first()).toBeVisible();
  await expect(page.getByText('Pris par le terminal · à l’instant')).toBeVisible();
  await expect(page.getByText('Consigne reçue · l’agent reprend')).toBeVisible();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('');
  expect(sends(d.received, 'session.reply')).toEqual([expect.objectContaining({ id: 'bix', text: 'Lance les tests' })]);
  expect(sends(d.received, 'session.reply')[0]).not.toHaveProperty('pendingId');
});

test('a refused send keeps the draft; the user sends it again explicitly, once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const d = await open(page);
  let n = 0;
  d.onMessage(m => {
    if (m.type === 'session.history') d.send({ type: 'session.turns', id: m.id, turns: TURNS });
    if (m.type === 'session.reply') { n++; d.send({ type: 'operation.result', operationId: m.operationId, status: n === 1 ? 'rejected' : 'applied', ...(n === 1 ? { reason: 'agent_busy' } : {}) }); }
  });
  await page.goto('/m/#/thread/bix');
  await page.getByLabel('Message pour Bix').fill('Lance les tests');
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect(page.getByRole('alert')).toContainText('Message non envoyé');
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
  await page.waitForTimeout(400);
  expect(sends(d.received, 'session.reply')).toHaveLength(1);
  await page.screenshot({ path: 'e2e/shots/thread-send-failure-390.png' });
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('');
  expect(sends(d.received, 'session.reply')).toHaveLength(2);
});

test('a lost link while sending is uncertain, keeps the draft and never resends by itself', async ({ page }) => {
  const d = await open(page);
  d.onMessage(m => {
    if (m.type === 'session.history') d.send({ type: 'session.turns', id: m.id, turns: TURNS });
    if (m.type === 'session.reply') d.drop();
  });
  await page.goto('/m/#/thread/bix');
  await page.getByLabel('Message pour Bix').fill('Lance les tests');
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect(page.getByRole('alert')).toContainText('Réception non confirmée');
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
  await page.waitForTimeout(1500);
  expect(sends(d.received, 'session.reply')).toHaveLength(1);
});

test('the awaiting card opens the same request as the inbox; free input stays disabled', async ({ page }) => {
  const since = ago(2);
  const s = idle({ state: 'waiting_permission', pending: { id: 'p-bix', version: 1, since, kind: 'permission', text: 'pnpm test --filter overlay', source: 'hook', risk: 'low' } });
  await open(page, s);
  await page.goto('/m/#/thread/bix');
  await expect(page.getByText('Décision attendue · dans « À traiter »')).toBeVisible();
  await expect(page.getByLabel('Message pour Bix')).toBeDisabled();
  await expect(page.getByText('En attente d’une décision')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lance les tests' })).toHaveCount(0);
  await page.getByRole('link', { name: /Examiner la demande/ }).click();
  await expect(page).toHaveURL(/#\/request\/bix\/p-bix$/);
});

test('a working agent closes the composer', async ({ page }) => {
  await open(page, idle({ state: 'working' }));
  await page.goto('/m/#/thread/bix');
  await expect(page.getByText('Au travail · consultez le terminal')).toBeVisible();
  await expect(page.getByLabel('Message pour Bix')).toBeDisabled();
  await expect(page.getByLabel('Message pour Bix')).toHaveAttribute('placeholder', 'L’agent travaille…');
});

test('the request result links to the thread', async ({ page }) => {
  const since = ago(2);
  const s = idle({ state: 'waiting_permission', pending: { id: 'p-bix', version: 1, since, kind: 'permission', text: 'pnpm test', source: 'hook', risk: 'low' } });
  const d = await open(page, s);
  d.onMessage(m => { if (m.type === 'session.decide') { d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' }); } });
  await page.goto('/m/#/request/bix/p-bix');
  await page.getByRole('button', { name: 'Autoriser une fois' }).click();
  await expect(page.getByText(/Elle apparaît maintenant dans le fil de cette session/)).toBeVisible();
  await page.getByRole('link', { name: 'Voir le fil de Bix' }).click();
  await expect(page).toHaveURL(/#\/thread\/bix$/);
});

test('after a link loss the daemon never heard of the operation: composer reopens, one explicit tap, two replies in all', async ({ page }) => {
  const d = await open(page);
  let n = 0;
  d.onMessage(m => {
    if (m.type === 'session.history') d.send({ type: 'session.turns', id: m.id, turns: TURNS });
    if (m.type === 'session.reply') { n++; if (n === 1) d.drop(); else d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' }); }
    if (m.type === 'operation.status') d.send({ type: 'operation.result', operationId: m.operationId, status: 'unknown' });
  });
  await page.goto('/m/#/thread/bix');
  await page.getByLabel('Message pour Bix').fill('Lance les tests');
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect.poll(() => sends(d.received, 'operation.status').length).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toContainText('Message non envoyé');
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
  await expect(page.getByLabel('Message pour Bix')).toBeEnabled();
  await page.waitForTimeout(500);
  expect(sends(d.received, 'session.reply')).toHaveLength(1);
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('');
  expect(sends(d.received, 'session.reply')).toHaveLength(2);
});

test('a cold start offline reads the last known thread; an unopened one says it is unavailable', async ({ page }) => {
  await page.addInitScript(([k, v, t]) => { if (!localStorage.getItem(k!)) { localStorage.setItem('ledge.mobile.token', 't'.repeat(43)); localStorage.setItem(k!, v!); localStorage.setItem('ledge.mobile.turns', t!); } }, ['ledge.mobile.lastState', JSON.stringify({ sessions: [idle(), session('kai', { name: 'Kai', topic: 'Autre' })], previews: {}, syncedAt: new Date().toISOString(), pcName: 'PC' }), JSON.stringify({ bix: TURNS })]);
  await page.routeWebSocket(/.*/, ws => { void ws.close({ code: 1001 }); });
  await page.goto('/m/#/thread/bix');
  await expect(page.getByText('La recherche de sessions est prête.')).toBeVisible();
  await expect(page.getByText('Aucun échange pour le moment.')).toHaveCount(0);
  await expect(page.getByLabel('Message pour Bix')).toBeDisabled();
  await page.goto('/m/#/thread/kai');
  await expect(page.getByText('Fil indisponible hors connexion')).toBeVisible();
  await expect(page.getByText('Aucun échange')).toHaveCount(0);
});

test('a draft equal to an old, applied instruction survives a reload', async ({ page }) => {
  const d = await open(page);
  d.onMessage(m => {
    if (m.type === 'session.history') d.send({ type: 'session.turns', id: m.id, turns: TURNS });
    if (m.type === 'session.reply') d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' });
  });
  await page.goto('/m/#/thread/bix');
  await page.getByLabel('Message pour Bix').fill('Lance les tests');
  await page.getByRole('button', { name: 'Envoyer à Bix' }).click();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('');
  d.upsert(idle({ state: 'working' }));
  d.upsert(idle({ lastActivityAt: ago(0) }));
  await page.getByLabel('Message pour Bix').fill('Lance les tests');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ledge.mobile.draft.bix'))).toBe('Lance les tests');
  await page.reload();
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
  await page.waitForTimeout(400);
  await expect(page.getByLabel('Message pour Bix')).toHaveValue('Lance les tests');
});
