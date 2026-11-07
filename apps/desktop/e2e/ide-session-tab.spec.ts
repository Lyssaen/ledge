import type { Locator, Page } from '@playwright/test';
import type { ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { at, fleet, ottoThread, tool } from './thread';

// The IDE session tab (lot 2) at the mockup's size (docs/mockups/ledge-ide-interactive.html, v26): the tab's label and alert,
// each tab's own view and scroll, Ctrl+` and the tab menu, the bottom bar and its narrowing, « +N −N »'s Changes beside.
test.use({ viewport: { width: 1920, height: 1080 } });
// Each test opens session pages and xterms more than once: more than the default 30 s under load.
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

const CAN = { version: '0.13.0', install: 'npm' as const, systemd: true, archive: true, models: true, modelSwitch: true };
const claude = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', description: 'Most capable.', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', isDefault: true }];

/** Nova's long thread: forty turns, each writing a file (« +N −N » adds them up), long enough to scroll. */
const novaThread: ThreadItem[] = Array.from({ length: 40 }, (_, i) => [
  { kind: 'prompt', id: `p${i}`, at: at(-900 + i * 20), turn: i + 1, text: `Étape ${i + 1} : écris le module ${i + 1}` } as ThreadItem,
  tool(`w${i}`, -895 + i * 20, 'Write', `/w/ledge/src/mod${i}.ts`, { turn: i + 1, durationMs: 200, files: [{ path: `/w/ledge/src/mod${i}.ts`, change: 'edit', diff: '- old\n+ new\n+ more' }] }),
  { kind: 'reply', id: `r${i}`, at: at(-890 + i * 20), turn: i + 1, text: `Module ${i + 1} écrit. Les tests passent, la suite est prête pour l'étape suivante.` } as ThreadItem
]).flat();

const sessions = [
  // Otto waits for an approval (red line under its tab).
  fleet.find(s => s.id === 'otto')!,
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect', model: 'claude-opus-5-5', effort: 'high',
    context: { used: 84_000, window: 200_000, at: at(0) } }),
  // A seat of the rig ledge-dev.
  session('ivo', { name: 'Ivo', project: 'ledge', cwd: '/w/ledge', state: 'working', source: 'rig', tmuxSession: 'dev-agent@ledge-dev', rig: { seat: 'dev-agent@ledge-dev', name: 'ledge-dev', role: 'dev.agent' } })
];

const box = async (l: Locator) => (await l.boundingBox())!;
const tabs = (page: Page) => page.locator('.ide-dockview .dv-tab');
const tabOf = (page: Page, name: string) => tabs(page).filter({ has: page.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });
/** A tab whose label is its title alone (not a session's). */
const plainTab = (page: Page, title: string) => tabs(page).filter({ hasText: title });
const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
const thread = (page: Page, name: string) => pane(page, name).locator('.session-thread');
const bar = (page: Page, name: string) => pane(page, name).locator('.ide-bar');
const scrollOf = (l: Locator) => l.evaluate(el => el.scrollTop);

async function boot(page: Page): Promise<void> {
  await fakeDaemon(page, sessions, { projects: twoProjects, daemon: CAN, models: { claude }, threads: { otto: ottoThread, nova: novaThread } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
}
async function open(page: Page, name: string, view: 'Projects' | 'OpenRig rigs' = 'Projects'): Promise<void> {
  // The explorer shows the projects' sessions or the rigs' seats (activity bar).
  const button = page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: view, exact: true });
  if (!(await button.getAttribute('class'))?.includes('on')) await button.click();
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
  // The session page's chunk loads on the first visit: under load it can take a while.
  await expect(pane(page, name).locator('.session-page')).toBeVisible({ timeout: 20_000 });
}
/** Two frames: what a scroll, a resize or a render sets off (listeners, observers, React's commit) has run. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
/** Scrolls a thread to the middle of its height and gives back where it stopped. */
async function toMiddle(l: Locator): Promise<number> {
  await expect.poll(() => l.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1000);
  const top = await l.evaluate(el => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); el.dispatchEvent(new Event('scroll')); return el.scrollTop; });
  // The page has taken the scroll (its listener, a render) and left it where it was set.
  await frames(l.page());
  expect(await l.evaluate(el => el.scrollTop)).toBe(top);
  return top;
}
async function tabMenu(page: Page, name: string, item: string): Promise<void> {
  await tabOf(page, name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

test('a session tab shows its logo, dot and name; approval is underlined red; a seat carries its rig', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  await open(page, 'Ivo', 'OpenRig rigs');
  for (const name of ['Otto', 'Nova', 'Ivo']) {
    const t = tabOf(page, name);
    await expect(t.locator('.tab-logo svg')).toBeVisible();
    await expect(t.locator('.tab-dot')).toBeVisible();
    await expect(t.locator('.tab-name')).toHaveText(new RegExp(`^${name}`));
  }
  await expect(tabOf(page, 'Otto')).toHaveClass(/\balert\b/);
  const shadow = await tabOf(page, 'Otto').evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).toMatch(/inset/);
  expect(shadow).toMatch(/0px -2px 0px/);
  // The red of --destructive, not the amber of a question.
  const red = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--destructive)'; document.querySelector('.ide-dock')!.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  expect(shadow).toContain(red);
  await expect(tabOf(page, 'Nova')).not.toHaveClass(/\balert/);
  await expect(tabOf(page, 'Ivo').locator('.tab-rig')).toHaveText('ledge-dev');
  await expect(tabOf(page, 'Nova').locator('.tab-rig')).toHaveCount(0);
  await page.locator('.ide-dockview .dv-tabs-and-actions-container').first().screenshot({ path: 'e2e/.results/ide-session-tab.png' });
  await page.screenshot({ path: 'e2e/.results/ide-session-tab-full.png' });
});

test('R6: a tab keeps its scroll when another tab is shown and when its view goes to the terminal and back', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  // (a) A → B → A. Only meaningful in Chromium, where a detached DOM loses its position.
  const mid = await toMiddle(thread(page, 'Nova'));
  expect(mid).toBeGreaterThan(500);
  await tabOf(page, 'Otto').click();
  await expect(thread(page, 'Otto')).toBeVisible();
  await tabOf(page, 'Nova').click();
  await expect(thread(page, 'Nova')).toBeVisible();
  await expect.poll(() => scrollOf(thread(page, 'Nova'))).toBeGreaterThanOrEqual(mid - 2);
  expect(Math.abs(await scrollOf(thread(page, 'Nova')) - mid)).toBeLessThanOrEqual(2);

  // (b) A's view to the terminal by the tab menu, then « Back to the thread ».
  const up = await thread(page, 'Nova').evaluate(el => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 3); el.dispatchEvent(new Event('scroll')); return el.scrollTop; });
  await frames(page);
  expect(await scrollOf(thread(page, 'Nova'))).toBe(up);
  await tabMenu(page, 'Nova', 'Switch to the terminal');
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeVisible();
  await tabMenu(page, 'Nova', 'Back to the thread');
  await expect(thread(page, 'Nova')).toBeVisible();
  await expect.poll(() => scrollOf(thread(page, 'Nova'))).toBeGreaterThanOrEqual(up - 2);
  expect(Math.abs(await scrollOf(thread(page, 'Nova')) - up)).toBeLessThanOrEqual(2);
});

test('Ctrl+` puts the agent\'s screen in place of the thread and >_ on the tab; the tab menu brings the thread back', async ({ page }) => {
  await boot(page);
  await open(page, 'Nova');
  await expect(tabOf(page, 'Nova').locator('.tab-term')).toHaveCount(0);
  await thread(page, 'Nova').focus();
  await page.keyboard.press('Control+Backquote');
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeVisible();
  await expect(thread(page, 'Nova')).toBeHidden();
  await expect(tabOf(page, 'Nova').locator('.tab-term')).toHaveText('>_');
  // What the agent screen's footer said outside the IDE (lot 3, option A): its state and its pane.
  await expect(tabOf(page, 'Nova').locator('.tab-term')).toHaveAttribute('title', /^Terminal view · [a-z].* · tmux · /);
  await tabMenu(page, 'Nova', 'Back to the thread');
  await expect(thread(page, 'Nova')).toBeVisible();
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeHidden();
  await expect(tabOf(page, 'Nova').locator('.tab-term')).toHaveCount(0);
});

test('the bottom bar: 28 px, model, context, branch, project, then +N −N at the right; +N opens the Changes beside; narrowing hides in order', async ({ page }) => {
  await boot(page);
  await open(page, 'Nova');
  const b = bar(page, 'Nova');
  await expect(b).toBeVisible();
  expect((await box(b)).height).toBe(28);
  const model = b.locator('.ide-bar-model'), ctx = b.locator('.ide-bar-ctx'), branch = b.locator('.ide-bar-chip.br'), project = b.locator('.ide-bar-chip.pj'), chip = b.locator('.dchip');
  await expect(model.locator('.model-chip')).toBeVisible();
  await expect(ctx).toContainText('42 %');
  await expect(branch).toHaveText('fix/LEDGE-42-ssh-reconnect');
  await expect(chip).toContainText('+80');
  await expect(chip).toContainText('−40');
  const xs = [];
  for (const l of [model, ctx, branch, project, chip]) xs.push((await box(l)).x);
  expect([...xs].sort((p, q) => p - q)).toEqual(xs);
  // Glued to the right: the bar's 10 px padding and nothing else.
  const barBox = await box(b), chipBox = await box(chip);
  expect(barBox.x + barBox.width - (chipBox.x + chipBox.width)).toBeLessThanOrEqual(11);
  // The model as the mockup's `.mdl`: the provider's logo, the name without the effort, a ▾ (the element the 470 px step hides).
  await expect(model.locator('.model-chip')).toHaveText('Opus 5.5▾');
  await expect(model.locator('.model-chip .logo')).toHaveAttribute('title', 'Anthropic');
  const caret = b.locator('.model-chip .car');
  await expect(caret).toBeVisible();
  expect(await caret.evaluate(el => el === el.parentElement!.lastElementChild && el.textContent)).toBe('▾');
  await b.screenshot({ path: 'e2e/.results/ide-session-bar.png' });
  // The whole group (tabs, thread, reply, bar), to set beside the mockup's.
  await page.locator('.ide-dockview .dv-groupview').first().screenshot({ path: 'e2e/.results/ide-session-group.png' });

  // « +N −N » → a second group « Changes · Nova » on the right.
  await chip.click();
  const groups = page.locator('.ide-dockview .dv-groupview');
  await expect(groups).toHaveCount(2);
  const changes = plainTab(page, 'Changes · Nova');
  await expect(changes).toBeVisible();
  expect((await box(changes)).x).toBeGreaterThan((await box(tabOf(page, 'Nova'))).x);
  await expect(chip).toHaveClass(/\bon\b/);

  // A click in the content of the first group (not its tab) focuses it; then one in the second's content focuses that one.
  const first = groups.nth(0), second = groups.nth(1);
  await thread(page, 'Nova').click({ position: { x: 20, y: 20 } });
  await expect(first).toHaveClass(/dv-active-group/);
  await expect(second).not.toHaveClass(/dv-active-group/);
  await second.locator('.dv-content-container').click({ position: { x: 40, y: 200 } });
  await expect(second).toHaveClass(/dv-active-group/);
  await expect(first).not.toHaveClass(/dv-active-group/);
  // The focused group's front tab carries the 2 px line on top.
  const stripe = (t: Locator) => t.evaluate(el => getComputedStyle(el, '::before').height);
  expect(await stripe(changes)).toBe('2px');
  await page.screenshot({ path: 'e2e/.results/ide-session-beside.png' });

  // Review Focus 5: narrower and narrower, the first group goes under 560, 470, 400 px; project, then %, then branch go,
  // and the bar never overflows.
  const paneWidth = () => b.evaluate(el => el.closest('.ide-pane')!.getBoundingClientRect().width);
  const seen = { 560: false, 470: false, 400: false };
  for (let w = 1920; w >= 900; w -= 20) {
    await page.setViewportSize({ width: w, height: 1080 });
    await frames(page);
    const pw = await paneWidth();
    const overflow = await b.evaluate(el => el.scrollWidth - el.clientWidth);
    expect(overflow, `bar overflow at a ${pw}px group`).toBeLessThanOrEqual(0);
    expect(await project.isVisible(), `project at ${pw}px`).toBe(pw > 560);
    expect(await ctx.locator('b').isVisible(), `% at ${pw}px`).toBe(pw > 470);
    expect(await caret.isVisible(), `caret at ${pw}px`).toBe(pw > 470);
    expect(await branch.isVisible(), `branch at ${pw}px`).toBe(pw > 400);
    if (pw <= 560) seen[560] = true;
    if (pw <= 470) seen[470] = true;
    if (pw <= 400) { seen[400] = true; break; }
  }
  expect(seen).toEqual({ 560: true, 470: true, 400: true });
  await b.screenshot({ path: test.info().outputPath('ide-session-bar-400.png') });
});

// The mono texts (branch, project, « +N −N », >_) use the font-mono token, as the mockup's `.mono`.
test('the bar\'s branch and « +N −N » are in the mono face, as in the mockup', async ({ page }) => {
  await boot(page);
  await open(page, 'Nova');
  for (const l of [bar(page, 'Nova').locator('.ide-bar-chip.br'), bar(page, 'Nova').locator('.dchip')])
    expect(await l.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/Mono|monospace/);
});

/** A colour token resolved by the browser, as an element's computed colour. */
const token = (page: Page, v: string) => page.evaluate(name => {
  const p = document.createElement('i'); p.style.color = `var(${name})`; document.querySelector('.ide-dock')!.append(p);
  const c = getComputedStyle(p).color; p.remove(); return c;
}, v);
const bg = (l: Locator) => l.evaluate(el => getComputedStyle(el).backgroundColor);

test('the mockup\'s look: 8 px dots with a halo on a request, the tab in front on the page\'s colour above a darker strip, the violet focus stripe, the reply box and thread across the group, « + »', async ({ page }) => {
  await boot(page);
  await open(page, 'Otto');
  await open(page, 'Nova');
  // The dot: 8 px; Otto waits for an approval, a 3 px halo of its colour.
  const dot = tabOf(page, 'Otto').locator('.tab-dot');
  expect((await box(dot)).width).toBe(8);
  expect(await dot.evaluate(el => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 3px/);
  expect(await tabOf(page, 'Nova').locator('.tab-dot').evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  // Surfaces: the tab in front is the editor's colour, the strip and the session bar another, the same.
  const strip = page.locator('.ide-dockview .dv-tabs-and-actions-container').first();
  const front = tabOf(page, 'Nova'), behind = tabOf(page, 'Otto');
  const editor = pane(page, 'Nova').locator('.session-page');
  expect(await bg(front)).toBe(await bg(editor));
  expect(await bg(strip)).not.toBe(await bg(front));
  expect(await bg(behind)).toBe(await bg(strip));
  expect(await bg(bar(page, 'Nova'))).toBe(await bg(strip));
  // The focused group's stripe: 2 px in the links' violet.
  const stripe = await front.evaluate(el => { const s = getComputedStyle(el, '::before'); return { h: s.height, c: s.backgroundColor }; });
  expect(stripe).toEqual({ h: '2px', c: await token(page, '--ide-link-violet') });
  // The reply box and the thread span the group, 12 px in from each side.
  const group = await box(page.locator('.ide-dockview .dv-groupview').first());
  const form = await box(pane(page, 'Nova').locator('.session-reply form'));
  expect(Math.abs(form.width - (group.width - 24))).toBeLessThanOrEqual(1);
  expect(Math.abs(form.x - (group.x + 12))).toBeLessThanOrEqual(1);
  expect((await box(pane(page, 'Nova').locator('.session-reply textarea'))).height).toBeGreaterThanOrEqual(72);
  // The rail fills the thread's content box (its clientWidth leaves the scrollbar out) less the 12 px paddings.
  const rail = await box(thread(page, 'Nova').locator('.rail'));
  const inner = await thread(page, 'Nova').evaluate(el => el.clientWidth);
  expect(Math.abs(rail.width - (inner - 24))).toBeLessThanOrEqual(1);
  await page.locator('.ide-dockview .dv-groupview').first().screenshot({ path: 'e2e/.results/ide-mockup-gaps-group.png' });
  await page.screenshot({ path: 'e2e/.results/ide-mockup-gaps-full.png' });
  // « + » then the split (lot 3) at the right end of the strip; « + » opens the launch dialog.
  const plus = strip.getByRole('button', { name: 'New session (N)' });
  const split = strip.getByRole('button', { name: 'Split right (Ctrl+\\)' });
  const sb = await box(strip), pb = await box(plus), xb = await box(split);
  expect(sb.x + sb.width - (xb.x + xb.width)).toBeLessThanOrEqual(8);
  expect(xb.x - (pb.x + pb.width)).toBeGreaterThanOrEqual(0);
  expect(xb.x - (pb.x + pb.width)).toBeLessThanOrEqual(4);
  await plus.click();
  await expect(page.getByRole('dialog', { name: 'New session' })).toBeVisible();
});

test('light theme: the same relation of surfaces, and the links\' darker violet', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.theme', 'light'); } catch { /* ignore */ } });
  await boot(page);
  await open(page, 'Nova');
  // The app's own theme setting (shell/theme.ts, desktop.theme) put the root in light.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const strip = page.locator('.ide-dockview .dv-tabs-and-actions-container').first();
  const front = tabOf(page, 'Nova');
  expect(await bg(front)).toBe(await bg(pane(page, 'Nova').locator('.session-page')));
  expect(await bg(strip)).not.toBe(await bg(front));
  expect(await token(page, '--ide-link-violet')).toBe('rgb(109, 40, 217)');
  await page.screenshot({ path: 'e2e/.results/ide-mockup-gaps-light.png' });
});

test('the tab\'s label sits in the middle of its 30 px, in Geist 12 px, as in the mockup', async ({ page }) => {
  await boot(page);
  await open(page, 'Nova');
  const t = tabOf(page, 'Nova');
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
  const tb = await box(t);
  for (const part of ['.tab-name', '.tab-logo svg', '.tab-dot']) {
    const b = await box(t.locator(part));
    expect(Math.abs(mid(b) - mid(tb)), `${part}: ${mid(b)} vs ${mid(tb)}`).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.fonts.check('12px Geist'))).toBe(true);
  const font = await t.locator('.tab-name').evaluate(el => { const s = getComputedStyle(el); return { family: s.fontFamily, size: s.fontSize }; });
  expect(font.family).toMatch(/^"?Geist"?(,|$)/);
  expect(font.size).toBe('12px');
  await page.locator('.ide-dockview .dv-tabs-and-actions-container').first().screenshot({ path: 'e2e/.results/ide-session-tab-centred.png' });
});

// A 300 px group is a normal width (lot 3): the narrow page's rules apply there, but the IDE reply keeps its reason hints.
test('in a 300 px group, Otto waiting for an approval: typed text shows « Enter denies with this message »', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1080 });
  await boot(page);
  await open(page, 'Otto');
  for (let i = 0; i < 3; i++) await page.locator('.ide-dockview .dv-groupview').nth(i).getByRole('button', { name: 'Split right (Ctrl+\\)' }).click();
  await expect(page.locator('.ide-dockview .dv-groupview')).toHaveCount(4);
  expect((await box(pane(page, 'Otto').locator('.session-page'))).width).toBeLessThan(600);
  await pane(page, 'Otto').locator('.session-reply textarea').fill('Pas ce fichier');
  await expect(pane(page, 'Otto').locator('.reply-hint', { hasText: 'Enter denies with this message' })).toBeVisible();
});
