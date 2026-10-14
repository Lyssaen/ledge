import { expect, test, type Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { fakeDaemon, session } from './daemon';

const TOKEN_KEY = 'ledge.mobile.token';
const OP_ID = /^[0-9a-f-]{36}$/;

const request = (id: string, extra: Partial<NonNullable<Session['pending']>> = {}, over: Partial<Session> = {}): Session => {
  const since = new Date(Date.now() - 3 * 60_000).toISOString();
  return session(id, {
    state: 'waiting_permission', name: 'Otto', topic: `Tâche ${id}`, repo: 'harness-assistant', branch: 'session-search', lastActivityAt: since,
    pending: { id: `p-${id}`, version: 1, since, kind: 'permission', text: 'pnpm --filter overlay test', source: 'hook', risk: 'low', riskReason: 'read_only_command', ...extra },
    ...over
  });
};
const handled = (s: Session): Session => { const { pending: _p, ...rest } = s; return { ...rest, state: 'working' }; };
const decides = (received: unknown[]) => received.filter((m): m is Record<string, unknown> => (m as { type?: string }).type === 'session.decide');

async function paired(page: Page) { await page.addInitScript(k => localStorage.setItem(k, 't'.repeat(43)), TOKEN_KEY); }
const noOverflow = async (page: Page) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
};

for (const width of [320, 390, 430]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 800 }); await paired(page); });

    test('accept a low-risk request: one decide message, transmission, then result and a lower count', async ({ page }) => {
      const a = request('a'); const b = request('b');
      const d = await fakeDaemon(page, [a, b]);
      d.onMessage(m => { if (m.type === 'session.decide') d.send({ type: 'operation.received', operationId: m.operationId }); });
      await page.goto('/m/');
      await expect(page.getByText('2 demandes. Choisissez par où commencer.')).toBeVisible();
      await page.getByRole('link', { name: /Tâche a/ }).click();
      await expect(page.getByText('La décision sera transmise immédiatement au PC.')).toBeVisible();
      await page.getByRole('button', { name: 'Autoriser une fois' }).click();
      await expect(page.getByText('Transmission au PC…')).toBeVisible();
      await expect(page.getByText('En attente de confirmation du terminal.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/decide-sending-${width}.png` });
      const [msg] = decides(d.received);
      expect(decides(d.received)).toHaveLength(1);
      expect(msg).toMatchObject({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'p-a', pendingVersion: 1 });
      expect(String(msg!.operationId)).toMatch(OP_ID);
      d.upsert(handled(a));
      d.send({ type: 'operation.result', operationId: msg!.operationId, status: 'applied' });
      await expect(page.getByRole('heading', { level: 1, name: 'Autorisation prise en compte' })).toBeVisible();
      await expect(page.getByText('Le terminal a reçu votre décision.')).toBeVisible();
      await expect(page.getByText('Une décision transmise ne peut pas être annulée.')).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/decide-result-${width}.png` });
      await page.getByRole('link', { name: 'Retour aux demandes' }).last().click();
      await expect(page.getByText('1 demande. Choisissez par où commencer.')).toBeVisible();
    });

    test('a double tap sends one message', async ({ page }) => {
      const d = await fakeDaemon(page, [request('dbl')]);
      await page.goto('/m/#/request/dbl/p-dbl');
      await page.getByRole('button', { name: 'Autoriser une fois' }).dblclick();
      await expect(page.getByText('Transmission au PC…')).toBeVisible();
      await page.waitForTimeout(300);
      expect(decides(d.received)).toHaveLength(1);
    });

    test('deny sends deny and shows the refusal result', async ({ page }) => {
      const s = request('den');
      const d = await fakeDaemon(page, [s]);
      await page.goto('/m/#/request/den/p-den');
      await page.getByRole('button', { name: 'Refuser' }).click();
      await expect.poll(() => decides(d.received).length).toBe(1);
      const m = decides(d.received)[0]!;
      expect(m).toMatchObject({ decision: 'deny', pendingId: 'p-den' });
      d.upsert(handled(s));
      d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' });
      await expect(page.getByRole('heading', { level: 1, name: 'Refus pris en compte' })).toBeVisible();
    });

    test('already handled on the PC: no authorize button', async ({ page }) => {
      const s = request('pc');
      const d = await fakeDaemon(page, [s]);
      await page.goto('/m/#/request/pc/p-pc');
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toBeVisible();
      d.upsert(handled(s));
      await expect(page.getByRole('heading', { level: 1, name: 'Déjà traitée sur le PC' })).toBeVisible();
      await expect(page.getByText('Cette demande a été résolue ailleurs. Aucune nouvelle décision n’a été envoyée.')).toBeVisible();
      await expect(page.getByRole('button', { name: /Autoriser/ })).toHaveCount(0);
      expect(decides(d.received)).toHaveLength(0);
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/decide-handled-${width}.png` });
    });

    test('cut after authorize: uncertain, then reconnect and verify shows the real result, nothing resent', async ({ page }) => {
      const s = request('cut');
      const d = await fakeDaemon(page, [s]);
      d.onMessage(m => {
        if (m.type === 'session.decide') { d.send({ type: 'operation.received', operationId: m.operationId }); d.drop(); }
        if (m.type === 'operation.status') {
          d.upsert(handled(s));
          d.send({ type: 'operation.result', operationId: m.operationId, status: 'applied' });
        }
      });
      await page.goto('/m/#/request/cut/p-cut');
      await page.getByRole('button', { name: 'Autoriser une fois' }).click();
      await expect(page.getByText('Réception non confirmée')).toBeVisible();
      await expect(page.getByText('La connexion a été perdue pendant l’envoi. La décision a peut-être été reçue. Vérifiez son état avant de recommencer.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/decide-uncertain-${width}.png` });
      await page.getByRole('button', { name: 'Reconnecter et vérifier' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Autorisation prise en compte' })).toBeVisible();
      expect(decides(d.received)).toHaveLength(1);
      expect(d.received.filter(m => (m as { type?: string }).type === 'operation.status').length).toBeGreaterThan(0);
    });

    test('changed version: the detail refreshes and nothing was injected', async ({ page }) => {
      const s = request('chg');
      const d = await fakeDaemon(page, [s]);
      await page.goto('/m/#/request/chg/p-chg');
      await expect(page.getByText('pnpm --filter overlay test')).toBeVisible();
      d.upsert(request('chg', { version: 2, text: 'pnpm --filter overlay test --force' }));
      await expect(page.getByText('La demande a été mise à jour. Relisez-la avant de décider.')).toBeVisible();
      await expect(page.getByText('pnpm --filter overlay test --force')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toBeDisabled();
      await page.getByRole('button', { name: 'J’ai relu la demande' }).click();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toBeEnabled();
      expect(decides(d.received)).toHaveLength(0);
      await page.getByRole('button', { name: 'Autoriser une fois' }).click();
      await expect.poll(() => decides(d.received).length).toBe(1);
      expect(decides(d.received)[0]).toMatchObject({ pendingVersion: 2 });
    });

    test('high risk: impact badge, danger button, no message sent from this task', async ({ page }) => {
      const d = await fakeDaemon(page, [request('hi', { risk: 'high', riskReason: 'pushes', text: 'git push --force origin main' })]);
      await page.goto('/m/#/request/hi/p-hi');
      await expect(page.getByText('Impact élevé').first()).toBeVisible();
      const verify = page.getByRole('button', { name: 'Vérifier et autoriser' });
      await expect(verify).toBeVisible();
      await expect(page.getByRole('button', { name: 'Autoriser une fois' })).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({ path: `e2e/shots/decide-high-${width}.png` });
      expect(decides(d.received)).toHaveLength(0);
    });

    test('a request without risk is treated as high', async ({ page }) => {
      const s = request('nr');
      delete (s.pending as { risk?: string }).risk;
      await fakeDaemon(page, [s]);
      await page.goto('/m/#/request/nr/p-nr');
      await expect(page.getByRole('button', { name: 'Vérifier et autoriser' })).toBeVisible();
    });

    test('a session started outside Ledge has no decision button', async ({ page }) => {
      await fakeDaemon(page, [request('ro', {}, { source: 'hook_only' })]);
      await page.goto('/m/#/request/ro/p-ro');
      await expect(page.getByText('Session démarrée hors de Ledge : répondez dans le terminal.')).toBeVisible();
      await expect(page.getByRole('button', { name: /Autoriser|Refuser/ })).toHaveCount(0);
    });
  });
}
