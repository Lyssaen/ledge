import { expect, test, type Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

const TOKEN_KEY = 'ledge.mobile.token';
const OPTIONS = ['Sombre · Signal', 'Clair · Galet', 'Suivre le système'];

const question = (id: string, tool: Session['tool'] = 'claude'): Session => {
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  return session(id, {
    state: 'waiting_input', name: 'Nova', tool, topic: 'Thème au premier lancement', repo: 'harness-assistant', branch: 'theme-defaults', lastActivityAt: since,
    pending: { id: `p-${id}`, version: 1, since, kind: 'question', text: 'Quel thème utiliser par défaut ?', reason: 'Choisir le thème avant que l’utilisateur règle ses préférences.', options: OPTIONS, source: 'hook', risk: 'low', riskReason: 'question' }
  });
};
const replies = (received: unknown[]) => received.filter((m): m is Record<string, unknown> => (m as { type?: string }).type === 'session.reply');

for (const width of [320, 390, 430]) {
  test(`a choice alone sends nothing; Send sends the option number (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
    const s = question('q');
    const d = await fakeDaemon(page, [s]);
    d.onMessage(m => { if (m.type === 'session.reply') d.send({ type: 'operation.received', operationId: m.operationId }); });
    await page.goto('/m/#/request/q/p-q');
    await expect(page.getByRole('heading', { level: 1, name: 'Quel thème utiliser par défaut ?' })).toBeVisible();
    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(radios.nth(i)).not.toBeChecked();
    const send = page.getByRole('button', { name: 'Envoyer ma réponse' });
    await expect(send).toBeDisabled();
    await expect(page.getByText('Autre réponse')).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: `e2e/shots/question-${width}.png` });
    await page.getByRole('radio', { name: 'Clair · Galet' }).check();
    await expect(send).toBeEnabled();
    await page.screenshot({ path: `e2e/shots/question-chosen-${width}.png` });
    await page.waitForTimeout(200);
    expect(replies(d.received)).toHaveLength(0);
    await send.click();
    await expect(page.getByText('Transmission au PC…')).toBeVisible();
    expect(replies(d.received)).toHaveLength(1);
    const m = replies(d.received)[0]!;
    expect(m).toMatchObject({ type: 'session.reply', id: 'q', text: '2', pendingId: 'p-q', pendingVersion: 1 });
    expect(String(m.operationId)).toMatch(/^[0-9a-f-]{36}$/);
    const { pending: _p, ...rest } = s;
    d.upsert({ ...rest, state: 'working' });
    d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' });
    await expect(page.getByRole('heading', { level: 1, name: 'Réponse prise en compte' })).toBeVisible();
  });
}

const CAPS = { claude: { freeTextAnswer: true }, codex: { freeTextAnswer: false }, cursor: { freeTextAnswer: false } };

test('Autre réponse is hidden for a tool that cannot answer freely', async ({ page }) => {
  await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
  await fakeDaemon(page, [question('c', 'codex')], { capabilities: CAPS });
  await page.goto('/m/#/request/c/p-c');
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByText('Autre réponse')).toHaveCount(0);
});

test('Autre réponse is hidden when the PC does not say what a tool can do', async ({ page }) => {
  await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
  await fakeDaemon(page, [question('n')]);
  await page.goto('/m/#/request/n/p-n');
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByText('Autre réponse')).toHaveCount(0);
});

for (const width of [320, 390, 430]) {
  test(`Autre réponse needs a valid text and sends other: true (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
    const s = question('q');
    const d = await fakeDaemon(page, [s], { capabilities: CAPS });
    d.onMessage(m => { if (m.type === 'session.reply') d.send({ type: 'operation.received', operationId: m.operationId }); });
    await page.goto('/m/#/request/q/p-q');
    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(4);
    await expect(page.getByLabel('Votre réponse à Nova')).toHaveCount(0);
    const send = page.getByRole('button', { name: 'Envoyer ma réponse' });
    await page.screenshot({ path: `e2e/shots/question-other-${width}.png` });
    await page.getByRole('radio', { name: 'Autre réponse' }).check();
    const field = page.getByLabel('Votre réponse à Nova');
    await expect(field).toHaveAttribute('placeholder', 'Précisez votre choix…');
    await expect(send).toBeDisabled();
    await field.fill('   ');
    await expect(send).toBeDisabled();
    await field.fill('Mode auto\nsuivi');
    await expect(send).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('sur une ligne');
    await field.fill('x'.repeat(2001));
    await expect(send).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('trop longue');
    await field.fill('  Thème sombre, accent bleu  ');
    await expect(send).toBeEnabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: `e2e/shots/question-other-typed-${width}.png` });
    await send.click();
    await expect(page.getByText('Transmission au PC…')).toBeVisible();
    expect(replies(d.received)).toHaveLength(1);
    const m = replies(d.received)[0]!;
    expect(m).toMatchObject({ type: 'session.reply', id: 'q', text: 'Thème sombre, accent bleu', other: true, pendingId: 'p-q', pendingVersion: 1 });
    expect(String(m.operationId)).toMatch(/^[0-9a-f-]{36}$/);
    const { pending: _p, ...rest } = s;
    d.upsert({ ...rest, state: 'working' });
    d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' });
    await expect(page.getByRole('heading', { level: 1, name: 'Réponse prise en compte' })).toBeVisible();
  });
}

test('a free answer the PC refuses as invalid says why and can be corrected', async ({ page }) => {
  await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY);
  const d = await fakeDaemon(page, [question('q')], { capabilities: CAPS });
  d.onMessage(m => { if (m.type === 'session.reply') d.send({ type: 'operation.result', operationId: m.operationId, status: 'rejected', reason: 'invalid' }); });
  await page.goto('/m/#/request/q/p-q');
  await page.getByRole('radio', { name: 'Autre réponse' }).check();
  await page.getByLabel('Votre réponse à Nova').fill('Autre');
  await page.getByRole('button', { name: 'Envoyer ma réponse' }).click();
  await expect(page.getByText('Le PC n’a pas accepté cette réponse', { exact: false })).toBeVisible();
});

async function assertNoOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}
