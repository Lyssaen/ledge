import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, session, twoProjects } from './daemon';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// The IDE's size, as its mockups and the ide-* specs: between the sidebar and the chat, the floor fits there (at 1280 × 800 it
// stays at the zoom's 40 % floor, its own case below).
test.use({ viewport: { width: 1920, height: 1080 } });
// The first tests of a run pay Vite's first compile of the IDE chunk: on a loaded machine that is past 20 s.
test.setTimeout(60_000);

/** The IDE is up on its Atelier tab, the agents seated (its chunk loads on the first visit: it can take more than 5 s). */
async function booted(page: Page) {
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.ide-atelier button[data-agent]').first()).toBeVisible({ timeout: 15_000 });
}

const kit = session('kit', { name: 'Kit', cwd: '/tmp/scratch', project: 'scratch' });
const helper = (id: string) => ({ id, kind: 'Explore', task: `Task ${id}`, state: 'working' as const });
const crowd = [
  ...eight.map(s => s.id === 'otto' ? { ...s, helpers: ['o1', 'o2', 'o3'].map(helper) } : s.id === 'nova' ? { ...s, helpers: ['n1', 'n2'].map(helper) } : s),
  ...['ada', 'zed', 'zia'].map(id => session(id, { name: id[0]!.toUpperCase() + id.slice(1), cwd: '/w/ledge', project: 'ledge' }))
];

const scroller = (page: Page) => page.locator('.overview-scroll.atelier');
const noScroll = (page: Page) => scroller(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
const level = (page: Page) => page.getByRole('toolbar', { name: 'Atelier zoom' }).getByRole('button', { name: 'Back to 100 %' });
const pct = async (page: Page) => Number.parseInt((await level(page).textContent())!, 10);
const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('at fit nothing scrolls; Ctrl + wheel zooms under the pointer; + - 0', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  const ledge = page.getByRole('region', { name: 'Ledge table' });
  await expect(ledge).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  const fitted = await level(page).textContent();
  const fit = await pct(page);
  expect(fit).toBeGreaterThanOrEqual(40);
  expect(fit).toBeLessThanOrEqual(180);
  // Ctrl + wheel with the pointer on a seat: the seat stays under it.
  const seat = ledge.locator('.agent-seat:not(.helper-seat)').first();
  const b0 = center((await seat.boundingBox())!);
  await page.mouse.move(b0.x, b0.y);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  await expect(level(page)).not.toHaveText(fitted!);
  const zoomed = await pct(page);
  expect(zoomed).toBeGreaterThan(fit);
  const b1 = center((await seat.boundingBox())!);
  expect(Math.hypot(b1.x - b0.x, b1.y - b0.y), 'the seat stays near the pointer').toBeLessThan(60);
  // 0 refits, + and - step.
  await page.keyboard.press('0');
  await expect(level(page)).toHaveText(fitted!);
  expect(await noScroll(page)).toBe(true);
  await page.keyboard.press('+');
  await expect.poll(() => pct(page)).toBeGreaterThan(fit);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect.poll(() => pct(page)).toBeLessThan(fit);
  await page.keyboard.press('0');
  await expect(level(page)).toHaveText(fitted!);
});

// At 1280 × 800 the floor does not fit at the zoom's 40 % floor, which is wanted (design-ux, 2026-11-10): what matters is that
// the zoom bar stays on screen and the floor can be reached by zooming and dragging.
test('at 1280 × 800 the floor stays at 40 %: the zoom bar on screen, the floor zooms and pans', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect.poll(() => pct(page)).toBe(40);
  const bar = (await page.getByRole('toolbar', { name: 'Atelier zoom' }).boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(800);
  expect(bar.x + bar.width).toBeLessThanOrEqual(1280);
  await page.keyboard.press('+');
  await expect.poll(() => pct(page)).toBeGreaterThan(40);
  const v = (await scroller(page).boundingBox())!;
  const s0 = await scroller(page).evaluate(el => ({ l: el.scrollLeft, t: el.scrollTop }));
  const x = v.x + 12, y = v.y + v.height - 12;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y - 50, { steps: 5 }); await page.mouse.up();
  const s1 = await scroller(page).evaluate(el => ({ l: el.scrollLeft, t: el.scrollTop }));
  expect(s1.l !== s0.l || s1.t !== s0.t, 'the floor moved').toBe(true);
});

test('two fingers pinch the floor, not the window: the zoom follows them, the page stays at scale 1', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  const ledge = page.getByRole('region', { name: 'Ledge table' });
  await expect(ledge).toBeVisible();
  const fit = await pct(page);
  const seat = ledge.locator('.agent-seat:not(.helper-seat)').first();
  const s0 = center((await seat.boundingBox())!);
  // A real touchscreen pinch, through the DevTools protocol: two fingers 80 px apart around the seat, spread to 240.
  const cdp = await page.context().newCDPSession(page);
  const fingers = (gap: number) => [{ x: s0.x - gap / 2, y: s0.y, id: 1 }, { x: s0.x + gap / 2, y: s0.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(80) });
  for (let gap = 100; gap <= 240; gap += 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(gap) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => pct(page)).toBeGreaterThan(fit * 2);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), 'the WebView did not zoom the whole page').toBe(1);
  const s1 = center((await seat.boundingBox())!);
  expect(Math.hypot(s1.x - s0.x, s1.y - s0.y), 'the seat stays between the fingers').toBeLessThan(60);
  // One finger pans the zoomed floor.
  const before = await scroller(page).evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 600, y: 400, id: 3 }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 600 - i * 20, y: 400 - i * 10, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await scroller(page).evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
  expect(after.left - before.left).toBeCloseTo(100, -1);
  expect(after.top - before.top).toBeCloseTo(50, -1);
});

test('double-click frames a table, the floor fits again; legend and zoom bar stay put; dragging the floor pans', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  const legend = page.locator('.workspace-legend');
  await expect(legend).toBeVisible();
  const before = await legend.boundingBox();
  const bar = page.getByRole('toolbar', { name: 'Atelier zoom' });
  const barBefore = await bar.boundingBox();
  const fit = await pct(page);
  const table = page.getByRole('region', { name: 'Website table' });
  await table.locator('.office-rug').dblclick({ position: { x: 20, y: 60 } });
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false');
  expect(await pct(page)).toBeGreaterThan(fit);
  const t = (await table.boundingBox())!, v = (await scroller(page).boundingBox())!;
  expect(Math.abs(t.x + t.width / 2 - (v.x + v.width / 2))).toBeLessThan(v.width * 0.1);
  expect(Math.abs(t.y + t.height / 2 - (v.y + v.height / 2))).toBeLessThan(v.height * 0.1);
  // The table is framed inside its room, whose walls take some of the width.
  expect(t.width).toBeGreaterThan(v.width * 0.45);
  expect(await legend.boundingBox()).toEqual(before);
  expect(await bar.boundingBox()).toEqual(barBefore);
  // Panning: drag the empty floor, the scroll moves.
  await page.keyboard.press('-');
  await page.keyboard.press('+');   // zoomed, so there is something to pan (the framed level overflows)
  const s0 = await scroller(page).evaluate(el => ({ l: el.scrollLeft, t: el.scrollTop, overflow: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }));
  expect(s0.overflow).toBe(true);
  const x = v.x + 12, y = v.y + v.height - 12;   // the floor margin, outside any seat or label
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y - 50, { steps: 5 }); await page.mouse.up();
  const s1 = await scroller(page).evaluate(el => ({ l: el.scrollLeft, t: el.scrollTop }));
  expect(s1.l !== s0.l || s1.t !== s0.t, 'the scroll moved').toBe(true);
  await page.locator('.office-shell').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await noScroll(page)).toBe(true);
});

test('dezoomed, dragging the floor carries the whole group to any edge, and part of it always stays in sight (#42)', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('-');
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false');
  // The view overflows and still scrolls (panning sets scrollLeft / scrollTop), but shows no scrollbar (#49).
  expect(await scroller(page).evaluate(el => {
    const css = getComputedStyle(el);
    return { overflows: el.scrollWidth > el.clientWidth + 1 && el.scrollHeight > el.clientHeight + 1, overflow: [css.overflowX, css.overflowY], scrollbar: css.scrollbarWidth };
  })).toEqual({ overflows: true, overflow: ['auto', 'auto'], scrollbar: 'none' });
  // The group: Ledge's desk, the tables and « Sans projet », as one box.
  const group = () => page.locator('.office-shell').evaluate(shell => {
    const rs = [...shell.querySelectorAll('.ledge-corner,.project-room,.unassigned-zone')].map(el => el.getBoundingClientRect());
    const left = Math.min(...rs.map(r => r.left)), top = Math.min(...rs.map(r => r.top));
    return { left, top, right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)) };
  });
  const v = (await scroller(page).boundingBox())!, c = center(v);
  // Dezoomed around the centre of the view, the group stays in its middle instead of clinging to the top.
  const g0 = await group();
  expect(Math.abs((g0.left + g0.right) / 2 - c.x)).toBeLessThan(v.width * 0.1);
  expect(g0.top).toBeGreaterThan(v.y + 40);
  // Space + drag from the middle, three times each way.
  const drag = async (dx: number, dy: number) => {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down(' ');
      await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 }); await page.mouse.up();
      await page.keyboard.up(' ');
    }
  };
  await drag(v.width * 0.45, v.height * 0.4);
  const g1 = await group();
  expect(g1.left).toBeGreaterThan(c.x);
  expect(g1.top).toBeGreaterThan(c.y);
  expect(g1.left, 'some of the group stays in sight on the right').toBeLessThan(v.x + v.width - 100);
  expect(g1.top, 'and above the legend').toBeLessThan(v.y + v.height - 76 - 100);
  await drag(-v.width * 0.45, -v.height * 0.4);
  const g2 = await group();
  expect(g2.right).toBeLessThan(c.x);
  expect(g2.bottom).toBeLessThan(c.y);
  expect(g2.right, 'some of the group stays in sight on the left').toBeGreaterThan(v.x + 100);
  expect(g2.bottom).toBeGreaterThan(v.y + 100);
  // Fit brings it back, nothing to scroll.
  await page.keyboard.press('0');
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await noScroll(page)).toBe(true);
});

// Full screen is gone with the old interface (jde, 2026-11-09): only the resize is left.
test('a resize refits without scrollbars', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  const wide = await pct(page);
  await page.setViewportSize({ width: 1600, height: 960 });
  await expect.poll(() => pct(page)).toBeLessThan(wide);
  await expect.poll(() => noScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(() => pct(page)).toBe(wide);
  expect(await noScroll(page)).toBe(true);
});

test('drag Kit from Sans projet onto a table: the daemon gets the rule, Kit sits there', async ({ page }) => {
  const daemon = await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  await page.locator('.unassigned-card', { hasText: 'Kit' }).dragTo(page.getByRole('region', { name: 'Ledge table' }));
  await expect(page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  expect(daemon.received).toContainEqual(expect.objectContaining({ type: 'projects.set', projects: expect.objectContaining({ rules: [{ machine: 'local', path: '/tmp/scratch', project: 'ledge' }] }) }));
  await expect(page.locator('.toast')).toHaveText('Kit joins the Ledge table. Ledge will remember this folder.');
});

test('a crowded table: six seats, four at the ends, +N filters the atelier on the project', async ({ page }) => {
  await fakeDaemon(page, crowd, { projects: twoProjects });
  await page.goto('/'); await booted(page);
  const table = page.getByRole('region', { name: 'Ledge table' });
  await expect(table.locator('.agent-seat:not(.helper-seat)')).toHaveCount(6);
  await expect(table.locator('.helper-seat')).toHaveCount(4);
  await table.getByRole('button', { name: /\+3 at this table/ }).click();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveCount(0);
  // The filter reads in the Atelier tab's bar, as the old top bar's breadcrumb did.
  const bar = page.getByRole('toolbar', { name: 'Atelier', exact: true });
  await expect(bar.locator('.ide-abar-filter')).toHaveText('Ledge');
  await expect(bar.getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
});

test('a long project name on the rug is cut with an ellipsis and stays inside the rug', async ({ page }) => {
  const long = { projects: [{ ...twoProjects.projects[0]!, name: 'Payment Service Platform Migration Europe' }, twoProjects.projects[1]!], rules: [] };
  await fakeDaemon(page, eight, { projects: long });
  await page.goto('/'); await booted(page);
  const table = page.getByRole('region', { name: 'Payment Service Platform Migration Europe table' });
  const name = table.getByRole('button', { name: /^Conversations of project/ });
  await expect(name).toHaveAttribute('title', 'Payment Service Platform Migration Europe');
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const label = (await table.locator('.room-heading').boundingBox())!, rug = (await table.locator('.office-rug').boundingBox())!;
  expect(label.x + label.width).toBeLessThanOrEqual(rug.x + rug.width);
});

test('a message between agents: the bubble over Otto, an upright envelope flying to Nova\'s seat, which rings; no tag on the seats; reduced motion, no envelope (#27)', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  const otto = eight.find(s => s.id === 'otto')!;
  daemon.upsert({ ...otto, lastMessage: { id: 'sent-1', to: 'Nova', peer: 'nova', summary: 'The tests pass', at: new Date().toISOString() } });
  await expect(page.getByRole('button', { name: 'Otto writes to Nova: The tests pass. Open the conversation' })).toBeVisible();
  const envelope = page.locator('.exchange-layer .exchange-envelope');
  await expect(envelope).toHaveCount(1);
  const landedOff = envelope.evaluate(el => new Promise<number>(done => el.addEventListener('animationend', e => {
    if ((e as AnimationEvent).animationName !== 'envelope-fly') return;
    const seat = document.querySelector('.agent-seat[data-agent="local:nova"]')!.getBoundingClientRect(), b = el.getBoundingClientRect();
    done(Math.abs(b.x + b.width / 2 - (seat.x + seat.width / 2)));
  })));
  await expect(envelope).toHaveAttribute('aria-hidden', 'true');
  expect(await envelope.evaluate(el => { const s = getComputedStyle(el); return [s.offsetRotate, s.animationName]; })).toEqual(['0deg', 'envelope-fly, envelope-out']);
  // It lands on Nova's seat, which rings; then it fades out.
  const nova = page.locator('.agent-seat[data-agent="local:nova"]');
  await expect(nova).toHaveClass(/exchange-arrived/);
  // Where the flight ends, read when it ends: the ring is a timer and the fade-out moves it, so a later look can be off by tens
  // of pixels on a loaded machine.
  const off = await landedOff;
  expect(off, 'the envelope sits over the receiver').toBeLessThan(20);
  await expect.poll(() => envelope.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  await expect(page.locator('.peer-tag')).toHaveCount(0);
  // Reduced motion: the bubble and the wire, no envelope.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  daemon.upsert({ ...otto, lastMessage: { id: 'sent-2', to: 'Nova', peer: 'nova', summary: 'Merged', at: new Date().toISOString() } });
  await expect(page.getByRole('button', { name: /^Otto writes to Nova: Merged/ })).toBeVisible();
  await expect(page.locator('.exchange-wire path')).toHaveCount(1);
  await expect(envelope).toHaveCount(0);
});

test('the tiles start under Ledge\'s corner at every width, however tall its label grows (iPad, chat open)', async ({ page }) => {
  test.setTimeout(90_000);   // five widths, each a fresh load of the IDE
  const loose = ['ua', 'ub', 'uc'].map(id => session(id, { name: id.toUpperCase(), cwd: `/tmp/${id}`, project: `x-${id}` }));
  await fakeDaemon(page, [eight[0]!, eight[4]!, kit, ...loose], { projects: twoProjects });
  // A taller desk than Chromium's own fonts give, as Safari's do on an iPad: the mosaic must make room for it, not run into it.
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = '.ledge-desk>small{font-size:16px;line-height:64px}'; document.head.append(style);
  }));
  for (const [width, height, chat] of [[1600, 1000, true], [1600, 1000, false], [1180, 820, true], [820, 1180, false], [390, 844, false]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/'); await booted(page);
    await expect(page.locator('.unassigned-zone')).toBeVisible();
    // The IDE's right panel is open from the start and its layout is kept across loads: Ctrl / toggles it, so the state is set,
    // then checked, rather than toggled blindly.
    const right = page.locator('.ide-right');
    if ((await right.isVisible()) !== chat) await page.keyboard.press('Control+/');
    if (chat) await expect(right, `${width}x${height}: the chat is open`).toBeVisible();
    else await expect(right, `${width}x${height}: the chat is closed`).toBeHidden();
    await expect.poll(async () => page.evaluate(() => {
      const corner = document.querySelector('.ledge-corner')!.getBoundingClientRect();
      const tiles = [...document.querySelectorAll('.project-room,.unassigned-zone')].map(e => e.getBoundingClientRect());
      return tiles.filter(t => t.top < corner.bottom && t.left < corner.right && t.right > corner.left).length;
    }), `${width}x${height}${chat ? ', chat open' : ''}: no tile under Ledge's label`).toBe(0);
  }
});
