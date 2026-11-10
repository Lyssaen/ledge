import type { Page } from '@playwright/test';
import type { ThreadItem } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { at, fleet } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// The first tests of a run pay Vite's first compile of the IDE chunk: on a loaded machine that is past 20 s.
test.setTimeout(60_000);
/** The IDE is up on its Atelier tab, the agents seated. */
async function booted(page: Page) {
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.ide-atelier button[data-agent]').first()).toBeVisible({ timeout: 15_000 });
}

/* Captures of OpenRig's messages in a seat's thread, to hold against docs/mockups/ledge-openrig-messages-session-*.png.
   Not a check: it runs only with RIG_SHOTS=<folder>. */
const out = process.env.RIG_SHOTS;
test.skip(!out, 'captures only: RIG_SHOTS=<folder>');

const HANDOFF = 'qitem-20261102190205-c0704682203041b9';
const OUTGOING = 'qitem-20261102184644-9135ca8ab464cdb0';
const env = (from: string, body: string, gen = '45f7085e') => `From: ${from}\nTo: design-ux@ledge-dev-2\nSent: 11-02 19:02Z · gen ${gen}\n---\n${body}\n---\n↩ Reply: rig send ${from} "..."`;
const sentAt = at(-60);
const items: ThreadItem[] = [
  { kind: 'received', id: 'r1', at: at(-50), turn: 1, from: 'pilot-lead@ledge-dev-2', peer: 'bix', text: 'Validation maquette encoche (qitem-20261102184644). Ses mots : « Tout est ok, sauf le bouton play. Je veux pas qu’il soit simple et pas rond ».', rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', sentAt, gen: '6a740950', raw: env('pilot-lead@ledge-dev-2', 'Validation maquette encoche…', '6a740950') } },
  { kind: 'notice', id: 'n1', at: at(-49), turn: 1, notice: 'other', peer: 'bix', name: 'pilot-lead@ledge-dev-2', text: 'Queue handoff', rig: { kind: 'handoff', from: 'pilot-lead@ledge-dev-2', to: 'design-ux@ledge-dev-2', sentAt, qitem: HANDOFF, summary: 'Retouche maquette encoche : bouton lecture/pause en icône simple sans disque', raw: env('pilot-lead@ledge-dev-2', `Queue handoff: ${HANDOFF} - check your queue. Summary: Retouche maquette encoche`) } },
  { kind: 'sent', id: 's1', at: at(-48), turn: 1, to: 'dev-front@ledge-dev-2', text: 'Maquette encoche validée par l’utilisateur, avec une seule retouche. Commit 54a7f531 sur docs/notch-activity…', status: 'delivered', rig: { kind: 'message', to: 'dev-front@ledge-dev-2', command: 'rig send dev-front@ledge-dev-2 "…"', raw: 'rig send dev-front@ledge-dev-2 "design-ux : maquette encoche validée…"\nSent to dev-front@ledge-dev-2' } },
  { kind: 'notice', id: 'o1', at: at(-47), turn: 1, notice: 'other', outgoing: true, status: 'delivered', text: 'rig queue handoff', rig: { kind: 'handoff', to: 'pilot-lead@ledge-dev-2', qitem: OUTGOING, summary: 'Maquette encoche fermée rendue : 6 questions ouvertes à faire trancher par l’utilisateur', command: 'rig queue handoff …', raw: `rig queue handoff ${OUTGOING} --to pilot-lead@ledge-dev-2 --summary "Maquette encoche fermée rendue…"` } },
  { kind: 'prompt', id: 'p2', at: at(-40), turn: 2, text: 'Regarde aussi le mobile.' },
  { kind: 'notice', id: 'u1', at: at(-30), turn: 3, notice: 'other', text: 'Blocker', rig: { kind: 'unblocked', from: 'daemon@kernel', qitem: 'qitem-20261102184941-4389f392504db9e3', blocker: 'qitem-20261102184222-c844fa05df894750', raw: 'Blocker qitem-20261102184222-c844fa05df894750 resolved; parked qitem qitem-20261102184941-4389f392504db9e3 is pending.' } },
  { kind: 'notice', id: 'a1', at: at(-29), turn: 3, notice: 'other', text: 'Stuck sweep', rig: { kind: 'openrig', from: 'daemon@kernel', alert: 'stalled', qitem: 'qitem-20261102193758-ffc1de6e4e82e13b', minutes: 7, raw: 'From: daemon@kernel\n…\nStuck sweep: stalled-after-claim on qitem-20261102193758-ffc1de6e4e82e13b (7 min)' } },
  { kind: 'notice', id: 'q1', at: at(-28), turn: 3, notice: 'other', text: 'Custody not checked', rig: { kind: 'openrig', from: 'daemon@kernel', alert: 'custody', raw: 'Custody not checked' } },
  { kind: 'notice', id: 'q2', at: at(-27), turn: 3, notice: 'other', text: 'relance levée', rig: { kind: 'openrig', from: 'daemon@kernel', raw: 'relance levée' } },
  { kind: 'received', id: 'd1', at: at(-26), turn: 3, from: 'pilot-lead@ledge-dev-2', peer: 'bix', text: 'L’utilisateur retient l’option A pour la bulle (« 3. A », 19:09Z, via l’opérateur). dev-front est prévenu.', rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', sentAt, gen: '7c0d11aa', count: 2, raw: 'From: pilot-lead@ledge-dev-2 … gen 7c0d11aa\n\nFrom: pilot-lead@ledge-dev-2 … gen 7c0d11aa' } },
  { kind: 'received', id: 'k1', at: at(-25), turn: 3, from: 'operator-agent@kernel', text: '« Oui, now » : lance la maquette des messages OpenRig maintenant.', rig: { kind: 'message', from: 'operator-agent@kernel', sentAt, packet: { id: 'p9', index: 0, count: 2 }, raw: env('operator-agent@kernel', '« Oui, now »…', '2f0e9a71') } },
  { kind: 'received', id: 'k2', at: at(-25), turn: 3, from: 'pilot-lead@ledge-dev-2', peer: 'bix', text: 'Ligne créée pour toi, voir la carte suivante.', rig: { kind: 'message', from: 'pilot-lead@ledge-dev-2', sentAt, packet: { id: 'p9', index: 1, count: 2 }, raw: env('pilot-lead@ledge-dev-2', 'Ligne créée pour toi…') } },
  { kind: 'notice', id: 'x1', at: at(-24), turn: 3, notice: 'other', text: 'bad', rig: { kind: 'unreadable', raw: 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance : la maquette est-elle prête ?' } }
];
const sessions = fleet.map(s => s.id === 'otto' ? { ...s, name: 'Lu', pending: undefined, state: 'working' as const, rig: { seat: 'design-ux@ledge-dev-2', name: 'ledge-dev-2' } }
  : s.id === 'nova' ? { ...s, name: 'Bix', rig: { seat: 'pilot-lead@ledge-dev-2', name: 'ledge-dev-2' } } : s);
const withBix = sessions.map(s => s);

for (const theme of ['dark', 'light'] as const) {
  test(`OpenRig messages in a seat's thread, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
    const bixId = withBix.find(s => s.name === 'Bix')!.id;
    const thread = items.map(i => ('peer' in i && i.peer === 'bix' ? { ...i, peer: bixId } : i)) as ThreadItem[];
    const d = await fakeDaemon(page, withBix, { projects: twoProjects, threads: { otto: thread }, daemon: { version: '0.38.0', install: 'npm', systemd: true, openrigRows: true } });
    await page.goto('/'); await booted(page);
    // A rig seat is not in the explorer's projects: the palette (Ctrl+K) opens it.
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Palette' }).fill('Lu');
    await page.getByRole('dialog', { name: 'Palette' }).getByRole('option', { name: /^Lu\b/ }).first().click();
    await expect(page.locator('[data-rig="handoff"]').first()).toBeVisible();
    // The rows' state, as the daemon would answer.
    await expect.poll(() => d.received.filter(m => m.type === 'openrig.row').length).toBeGreaterThanOrEqual(2);
    for (const m of d.received.filter((x): x is Extract<typeof x, { type: 'openrig.row' }> => x.type === 'openrig.row')) {
      const done = m.qitem === HANDOFF;
      d.push({ type: 'openrig.rowState', requestId: m.requestId, qitem: m.qitem, row: { id: m.qitem, state: done ? 'done' : 'pending', from: done ? 'pilot-lead@ledge-dev-2' : 'design-ux@ledge-dev-2', to: done ? 'design-ux@ledge-dev-2' : 'pilot-lead@ledge-dev-2', createdAt: at(-49), ...(done ? { claimedAt: at(-49) } : {}), updatedAt: at(-48), at: at(-1) } });
    }
    await expect(page.locator('[data-state="done"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.session-thread').screenshot({ path: `${out}/desktop-rig-${theme}.png` });
    // Every raw unfolded, as the mockup's « Tout le brut ».
    for (const s of await page.locator('details.rig-raw > summary').all()) await s.click();
    await page.locator('.session-thread').screenshot({ path: `${out}/desktop-rig-raw-${theme}.png` });
  });
}
