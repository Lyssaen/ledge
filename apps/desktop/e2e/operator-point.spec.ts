import type { Page } from '@playwright/test';
import type { ChatPoint, ChatTurn, ClientMessage, PointItem } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon } from './daemon';
import { ideReady } from './ide';

// The operator's point in the IDE's right chat panel (docs/mockups/ledge-operator.html, board 1), on the fake daemon: zoomed
// screenshots in both themes, and a destructive answer asked again before it goes confirmed.
// The screenshots land in e2e/.results/operator-point-*/.

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const fleet = eight.filter(s => ['otto', 'nova', 'luna'].includes(s.id));
const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const item = (o: Partial<PointItem> & Pick<PointItem, 'id' | 'group'>): PointItem => ({ event: 1, tone: 'idle', who: 'Rex', text: '', at: ago(20), ...o });
// Board 1's rows, as the daemon writes them.
const ITEMS: PointItem[] = [
  item({ id: 'rig.ask:q309', event: 11, group: 'atoi', tone: 'ask', who: 'pilot-lead', rig: 'ledge-dev', text: 'Fusionner #309 maintenant, ou attendre la revue de qa ?', ref: { kind: 'rig.ask', qitem: 'q309' },
    answers: [{ id: 'merge', label: 'Fusionner', style: 'primary' }, { id: 'wait', label: 'Attendre qa', style: 'plain' }], freeText: true, nav: [{ kind: 'rig', id: 'ledge-dev' }] }),
  item({ id: 'session.request:nova', event: 12, group: 'atoi', tone: 'perm', who: 'Nova', text: 'pnpm -r test -u', ref: { kind: 'session.request', session: 'nova', key: 'k1' },
    answers: [{ id: 'deny', label: 'Refuser', style: 'plain' }, { id: 'accept', label: 'Autoriser', style: 'primary' }], nav: [{ kind: 'session', id: 'nova' }] }),
  item({ id: 'session:rex', event: 9, group: 'done', who: 'Rex', text: 'a fini « socle-données »', sub: 'PR #41 ouverte, tests verts', at: ago(27), nav: [{ kind: 'pr', id: 'pr41' }],
    suggestion: { action: 'session.archive', args: { session: 'rex' }, summary: 'Archiver **Rex**', vars: { session: 'Rex' }, risk: 'reversible' } }),
  item({ id: 'session:pim', event: 8, group: 'done', tone: 'off', who: 'Pim', text: 's’est arrêtée : contexte plein', sub: 'tâche « Thème clair des réglages » laissée à moitié', at: ago(34),
    suggestion: { action: 'session.handover', args: { session: 'pim' }, summary: 'Passer le relais de **Pim**', vars: { session: 'Pim' }, risk: 'reversible' } }),
  item({ id: 'task:t1', event: 0, group: 'ongoing', tone: 'work', who: 'Iris', text: 'tient « Filtre MR par projet » depuis 2 h', sub: 'rien de neuf depuis 40 min' }),
  item({ id: 'rig:ledge-dev', event: 10, group: 'rigs', tone: 'perm', who: 'ledge-dev', text: ': le siège qa.reviewer ne répond plus depuis 13:58', sub: 'c’est lui qu’attend la décision sur #309', nav: [{ kind: 'rig', id: 'ledge-dev' }],
    suggestion: { action: 'rig.send', args: { rig: 'ledge-dev', seat: 'pilot-lead', text: 'qa ne répond plus' }, summary: 'Écrire à **pilot-lead**', vars: { rig: 'ledge-dev', seat: 'pilot-lead' }, risk: 'reversible' } })
];
const POINT: ChatPoint = { since: ago(42), lead: 'Depuis 13:50, six choses. **Deux t’attendent.**', leadBy: 'agent', items: ITEMS };
const turn = (point: ChatPoint = POINT): ChatTurn => ({ qid: 'point-1', question: '', askedAt: ago(1), steps: [], answeredAt: ago(1), by: 'ledge', point });

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Of<T> => m.type === type);
const panel = (page: Page) => page.locator('.ledge-chat-panel');

async function open(page: Page, theme: 'dark' | 'light', point?: ChatPoint) {
  await page.addInitScript(([t]) => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme]);
  const daemon = await fakeDaemon(page, fleet);
  await page.goto('/'); await ideReady(page);
  await expect(panel(page)).toBeVisible();
  daemon.push({ type: 'chat.history', turns: [turn(point)] });
  await expect(panel(page).locator('[data-point]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return daemon;
}

for (const theme of ['light', 'dark'] as const) {
  test(`the point as board 1, ${theme}`, async ({ page }, info) => {
    const daemon = await open(page, theme);
    const box = panel(page).locator('[data-point]');
    await expect(box).toContainText('de lui-même');
    await expect(box.getByRole('group')).toHaveCount(4);
    await panel(page).screenshot({ path: info.outputPath(`panel-${theme}.png`) });
    await box.screenshot({ path: info.outputPath(`point-${theme}.png`) });
    // Seen in the panel: its highest event is read.
    await expect.poll(() => sent(daemon.received, 'operator.read').map(m => m.eventId)).toContain(12);
  });

  test(`a settled row and a folded point, ${theme}`, async ({ page }, info) => {
    const settled = ITEMS.map(i => (i.id === 'session.request:nova' ? { ...i, settled: { at: ago(3), where: 'terminal' as const } } : i));
    const daemon = await open(page, theme, { ...POINT, items: settled });
    await panel(page).locator('[data-point-item="session.request:nova"]').screenshot({ path: info.outputPath(`settled-${theme}.png`) });
    daemon.push({ type: 'chat.history', turns: [turn({ ...POINT, foldedAt: ago(0) })] });
    await expect(panel(page).locator('[data-point-folded]')).toBeVisible();
    await panel(page).locator('[data-point-folded]').screenshot({ path: info.outputPath(`folded-${theme}.png`) });
  });
}

test('Autoriser is asked again, then goes confirmed', async ({ page }, info) => {
  const daemon = await open(page, 'light');
  const row = panel(page).locator('[data-point-item="session.request:nova"]');
  await row.getByRole('button', { name: 'Autoriser' }).click();
  await expect.poll(() => sent(daemon.received, 'point.act')).toEqual([{ type: 'point.act', qid: 'point-1', item: 'session.request:nova', answer: { id: 'accept' } }]);
  daemon.push({ type: 'error', message: 'confirm before applying a destructive action', request: 'point.act', code: 'confirm_required' });
  await expect(row).toContainText('Autoriser pour Nova ?');
  await row.screenshot({ path: info.outputPath('confirm-light.png') });
  await row.getByRole('button', { name: 'Autoriser' }).click();
  await expect.poll(() => sent(daemon.received, 'point.act').at(-1)).toEqual({ type: 'point.act', qid: 'point-1', item: 'session.request:nova', answer: { id: 'accept' }, confirmed: true });
});
