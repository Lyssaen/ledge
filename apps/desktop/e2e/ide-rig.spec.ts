import type { Page } from '@playwright/test';
import type { OpenRigState, RigGraph, RigSeatPermission } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { RIG_7A } from './openrig-fixtures';

// The « Rig · name » tab (lot 7c, docs/mockups/ledge-ide-rigs.html `topoPage`): opened from the Rigs view, restored after a reload.
test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });

const seat = (logicalId: string, runtime: string) => ({ logicalId, session: `${logicalId.replace('.', '-')}@ledge-survey`, runtime, model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const rig = (id: string, name: string) => ({ id, name, status: 'running' as const, lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: '2h', snapshot: null, nodes: [seat('dev.build', 'claude-code'), seat('dev.review', 'codex')] });
const state = {
  installed: true, version: '0.6.14', daemon: { state: 'running' as const, pid: 1, port: 7433 }, kernel: { state: 'ready' as const }, at: new Date().toISOString(),
  rigs: [rig('1', 'ledge-survey'), { ...rig('k', 'kernel'), nodes: [], seats: 1, running: 1 }]
};
const sessions = [session('otto')];
const rigsButton = (page: Page) => page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'OpenRig rigs' });
const view = (page: Page) => page.getByRole('complementary', { name: 'Rigs' });
const tab = (page: Page) => page.locator('.dv-tab').filter({ hasText: 'Rig · ledge-survey' });
const page$ = (page: Page) => page.locator('.ide-rig');

/** Four pods in a row: wider than a 470 px group, so the topology has to scroll. */
const WIDE: RigGraph = {
  pods: ['a', 'b', 'c', 'd'].map(id => ({ id, label: `Pod ${id}` })),
  seats: ['a', 'b', 'c', 'd'].map(id => ({ logicalId: `${id}.one`, pod: id, role: 'implementer', runtime: 'claude-code', status: 'running', session: `${id}-one@ledge-survey`, attention: false })),
  links: [{ from: 'a.one', to: 'b.one', kind: 'delegates_to' }, { from: 'b.one', to: 'c.one', kind: 'delegates_to' }, { from: 'c.one', to: 'd.one', kind: 'escalates_to' }]
};

async function boot(page: Page, opts: { ide?: boolean; layout?: object; graph?: RigGraph; state?: object; permissions?: { policy?: string; seats: RigSeatPermission[] }; sessions?: ReturnType<typeof session>[] } = {}) {
  await seedAtelier(page);
  await page.addInitScript(({ ide, layout }) => {
    try {
      if (ide) localStorage.setItem('ledge.ide.enabled', 'true');
      if (layout && !localStorage.getItem('ledge.ide.layout')) localStorage.setItem('ledge.ide.layout', JSON.stringify(layout));
    } catch { /* ignore */ }
  }, { ide: opts.ide !== false, layout: opts.layout ?? null });
  const daemon = await fakeDaemon(page, opts.sessions ?? sessions, {
    projects: twoProjects, openrig: (opts.state ?? state) as unknown as OpenRigState, rigCommands: ['rig down ledge-survey --snapshot'], ...RIG_7A,
    ...(opts.graph ? { rigGraphs: { 'ledge-survey': opts.graph } } : {}),
    rigPermissions: { ...RIG_7A.rigPermissions, 'ledge-survey': opts.permissions ?? { policy: 'builtin:auto', seats: [] } },
    daemon: { version: '0.53.0', install: 'npm', systemd: true, openrigRig: true, openrigPolicy: true }
  });
  await page.goto('/');
  return daemon;
}
const openSurvey = async (page: Page) => {
  await rigsButton(page).click();
  await view(page).locator('.ide-rigs-row').filter({ hasText: 'ledge-survey' }).getByRole('button', { name: 'ledge-survey', exact: true }).click();
};

test('a rig opens in a « Rig · ledge-survey » tab: header, topology, settings and queue; Stop asks under the header', async ({ page }) => {
  await boot(page);
  await openSurvey(page);
  await expect(tab(page)).toBeVisible();
  await expect(view(page).locator('.ide-rigs-row.sel')).toContainText('ledge-survey');
  const p = page$(page);
  await expect(p.getByRole('heading', { name: 'ledge-survey' })).toBeVisible();
  await expect(p.locator('.ide-rig-node')).toHaveCount(2);
  await expect(p.locator('.ide-rig-link')).not.toHaveCount(0);
  await expect(p.getByText('Settings', { exact: true })).toBeVisible();
  await expect(p.getByText('OpenRig queue')).toBeVisible();
  await expect(p.getByText('Run the build and report')).toBeVisible();

  await p.getByRole('button', { name: /^Stop/ }).click();
  const conf = p.locator('.ide-rig-top').getByRole('group');
  await expect(conf).toContainText('rig down ledge-survey');
});

test('one column: the topology on top, the settings and the queue under it; a seat says its role in the Rigs view (the user, 2026-11-09)', async ({ page }) => {
  test.setTimeout(90_000);
  const bix = session('bix', { name: 'Bix', rig: { seat: 'dev-build@ledge-survey', name: 'ledge-survey', role: 'dev.build' } });
  await boot(page, { sessions: [session('otto'), bix] });
  await openSurvey(page);
  const p = page$(page);
  await expect(p.locator('.ide-rig-node')).toHaveCount(2);
  const topo = (await p.locator('.ide-rig-block').first().boundingBox())!, side = (await p.locator('.ide-rig-side').boundingBox())!;
  expect(side.y).toBeGreaterThanOrEqual(topo.y + topo.height - 1);
  expect(Math.abs(side.x - topo.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(side.width - topo.width)).toBeLessThanOrEqual(1);
  // Under the rig (opening its tab unfolded it), Bix's row: its name, then its role; a seat with no session is already named by its role.
  const row = view(page).locator('.ide-rigs-row.seat').filter({ hasText: 'Bix' });
  await expect(row.locator('.ide-rigs-role')).toHaveText('dev.build');
  await expect(view(page).locator('.ide-rigs-row.seat.off')).toHaveText('dev.review');
  // − / +: the same square, the glyph at its centre.
  const minus = p.getByRole('button', { name: /^One seat fewer/ }).first(), plus = p.getByRole('button', { name: /^One more seat/ }).first();
  const centred = (b: typeof minus) => b.evaluate(el => { const r = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el); const g = range.getBoundingClientRect(); return Math.abs((g.left + g.right) / 2 - (r.left + r.right) / 2); });
  for (const b of [minus, plus]) { expect((await b.boundingBox())!.width).toBe(22); expect(await centred(b)).toBeLessThanOrEqual(1); }
  await p.locator('.ide-rig-step').first().screenshot({ path: 'e2e/.results/rig-step.png' });
  await view(page).screenshot({ path: 'e2e/.results/rig-roles-sidebar.png' });
  await page.screenshot({ path: 'e2e/.results/rig-one-column.png' });
});

test('the kernel offers « Talk to the operator »', async ({ page }) => {
  await boot(page);
  await rigsButton(page).click();
  // Under Kernel, its row is « Operations » (the user, 2026-11-09); it opens the kernel's Rig tab.
  await view(page).locator('.ide-rigs-row[data-target="kernel"]').getByRole('button', { name: 'Operations', exact: true }).click();
  await expect(page.locator('.dv-tab').filter({ hasText: 'Rig · kernel' })).toBeVisible();
  await expect(page$(page).getByRole('button', { name: 'Talk to the operator' })).toBeVisible();
});

test('at 480 px the settings go under the topology, and the topology scrolls inside the group', async ({ page }) => {
  await boot(page, { graph: WIDE });
  await openSurvey(page);
  await expect(page$(page).locator('.ide-rig-node')).toHaveCount(4);
  // Three splits and no sidebar: four groups of about 470 px.
  await page.keyboard.press('Control+b');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+\\');
  await expect(page.locator('.dv-groupview')).toHaveCount(4);
  const group = page.locator('.dv-groupview').first();
  await expect.poll(async () => (await group.boundingBox())!.width).toBeLessThanOrEqual(520);
  const blocks = page$(page).locator('.ide-rig-block');
  const topo = (await blocks.nth(0).boundingBox())!, settings = (await page$(page).locator('.ide-rig-side').boundingBox())!, g = (await group.boundingBox())!;
  expect(settings.y).toBeGreaterThanOrEqual(topo.y + topo.height - 1);
  expect(topo.x + topo.width).toBeLessThanOrEqual(g.x + g.width + 1);
  // The canvas is wider than its scroller: it scrolls inside the block instead of pushing the group.
  const scroller = page$(page).locator('.ide-rig-topo');
  expect(await scroller.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  expect(await scroller.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');
});

test('in a short window the settings and the queue scroll inside the tab; a permission level and a snapshot reach the daemon', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const ids = ['dev.b1', 'dev.b2', 'dev.b3', 'dev.b4', 'ops.c1', 'ops.c2', 'ops.c3'];
  const seven = { ...state, rigs: [{ ...rig('1', 'ledge-survey'), seats: 7, running: 7, nodes: ids.map(id => seat(id, 'claude-code')) }, state.rigs[1]!] };
  const graph: RigGraph = {
    pods: [{ id: 'dev', label: 'Dev' }, { id: 'ops', label: 'Ops' }],
    seats: ids.map(id => ({ logicalId: id, pod: id.split('.')[0]!, runtime: 'claude-code', status: 'running', session: `${id.replace('.', '-')}@ledge-survey`, attention: false })),
    links: []
  };
  const seats: RigSeatPermission[] = ids.map(id => ({ logicalId: id, session: `${id.replace('.', '-')}@ledge-survey`, source: 'rig_policy', policySource: 'rig_policy', summary: `Next launch: ${id}` }));
  const daemon = await boot(page, { state: seven, graph, permissions: { policy: 'builtin:auto', seats } });
  await openSurvey(page);
  await expect(page$(page).locator('.ide-rig-node')).toHaveCount(7);
  const scroller = page$(page);
  expect(await scroller.evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
  expect(await scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  const snap = scroller.getByRole('button', { name: 'Snapshot now' });
  await snap.scrollIntoViewIfNeeded();
  await expect(snap).toBeInViewport();
  await snap.click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.act' && (m.action as { kind: string }).kind === 'rig.snapshot')).toHaveLength(1);
  await scroller.getByRole('radio', { name: 'Standard' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'openrig.act' && (m.action as { kind: string }).kind === 'rig.policy')).toEqual([
    expect.objectContaining({ action: { kind: 'rig.policy', rig: 'ledge-survey', policy: 'standard', seats: ids.map(id => `${id.replace('.', '-')}@ledge-survey`) } })
  ]);
});

test('the tab is restored after a reload', async ({ page }) => {
  await boot(page);
  await openSurvey(page);
  await expect(tab(page)).toBeVisible();
  await page.reload();
  await expect(tab(page)).toBeVisible();
  await expect(page$(page).getByRole('heading', { name: 'ledge-survey' })).toBeVisible();
  await expect(page$(page).locator('.ide-rig-node')).toHaveCount(2);
});

test('with the switch off nothing new shows', async ({ page }) => {
  await boot(page, { ide: false });
  await expect(page.locator('.ide')).toHaveCount(0);
  await expect(page.locator('.ide-rig')).toHaveCount(0);
  await expect(page.getByText('Rig · ledge-survey')).toHaveCount(0);
});
