import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { fleet } from './thread';
import { ideReady } from './ide';

// #299 (docs/mockups/ledge-shell-marks.html, form A, « A, et tout les reco »): a free shell whose integration prints OSC 633 gets
// its command marks: a red line along a failed command, a dotted grey one along a running one, « ⋯ » and its menu on hover, a
// red mark in the right margin, the tab following P;Cwd. A shell printing none stays as it was.
// Captures: LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/shell-marks.spec.ts
// Scale 1: xterm's canvas draws at twice its size in headless Chromium at scale 2 (the rows no longer match their cells). The
// captures are the bottom panel alone, cropped.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const sessions = [fleet.find(s => s.id === 'otto')!, session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working' })];
const panel = (page: Page) => page.getByRole('region', { name: /^(Bottom panel|Panneau du bas)$/ });
const screenEl = (page: Page) => panel(page).locator('.ide-btile-screen:not([hidden]) .shell-marks-wrap');
const emit = (page: Page, text: string) => page.evaluate(t => (window as unknown as { __ledgePtyEmit: (s: string) => void }).__ledgePtyEmit(t), text);
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites.join(''));

const o = (s: string) => `\x1b]633;${s}\x07`;
const HOME = '/home/otto';
const prompt = (dir: string) => `${o('A')}\x1b[32motto@wsl\x1b[0m:\x1b[34m${dir}\x1b[0m$ ${o('B')}`;
/** One command as an integrated bash prints it: the line typed, E, C, its output, D with its code. */
const typed = (dir: string, cmd: string) => `${prompt(dir)}${cmd}\r\n${o(`E;${cmd}`)}${o('C')}`;
const ended = (code: number) => o(`D;${code}`);

async function boot(page: Page, theme: 'light' | 'dark', lang: 'fr' | 'en') {
  await seedAtelier(page);
  await page.addInitScript(([t, l]) => {
    try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ }
    (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false };
  }, [theme, lang]);
  await fakeDaemon(page, sessions, { projects: twoProjects, home: HOME });
  await page.goto('/');
  await ideReady(page);
  await page.keyboard.press('Control+j');
  await expect(screenEl(page)).toBeVisible();
}

/** The mockup's three commands: pnpm test (succeeded), pnpm lint (failed, code 1, 3,2 s), pnpm build (running). */
async function threeCommands(page: Page) {
  const dir = '~/Workspace/ledge';
  await emit(page, `\x1b[2J\x1b[H${o(`P;Cwd=${HOME}/Workspace/ledge`)}`);
  await emit(page, `${typed(dir, 'pnpm test')} \x1b[2m✓ 214 tests · 9.4 s\x1b[0m\r\n${ended(0)}`);
  await emit(page, typed(dir, 'pnpm lint'));
  await page.waitForTimeout(3200);
  await emit(page, `\x1b[31mapps/desktop/src/usage/UsageFooter.tsx\x1b[0m\r\n  92:5  error  'expired' is defined but never used\r\n\x1b[31m✖ 1 problem (1 error, 0 warnings)\x1b[0m\r\n${ended(1)}`);
  await emit(page, `${typed(dir, 'pnpm build')}vite v7.1 building for production…\r\n`);
}

test('a shell without OSC 633 shows no mark, as before', async ({ page }) => {
  await boot(page, 'light', 'en');
  await emit(page, 'ls\r\nREADME.md\r\n$ false\r\n$ ');
  await expect(screenEl(page).locator('.shell-marks')).toHaveCount(0);
  await expect(panel(page).locator('.ide-btile-tab').first()).toHaveText(/^>_\s*WSL · Ubuntu 1$/);
});

test('marks, the handle and its menu, the margin, the tab following cd', async ({ page }) => {
  await boot(page, 'light', 'en');
  await threeCommands(page);
  const marks = screenEl(page).locator('.shell-marks');
  await expect(marks.locator('.shell-mark-line.failed')).toHaveCount(1);
  await expect(marks.locator('.shell-mark-line.running')).toHaveCount(1);
  await expect(marks.locator('.shell-mark-fail')).toHaveCount(1);
  // The tab: its title, then the folder P;Cwd gives, from the folder it started in.
  await expect(panel(page).locator('.ide-btile-tab').first()).toHaveText(/^>_\s*WSL · Ubuntu 1 · ledge$/);

  // Hover the failed command: « ⋯ » with its tooltip; its menu.
  const line = await marks.locator('.shell-mark-line.failed').boundingBox();
  await page.mouse.move(line!.x + 200, line!.y + line!.height / 2);
  const handle = marks.locator('.shell-mark-handle');
  await expect(handle).toHaveAccessibleName(/^Exit code 1 · 3\.\d s$/);
  await expect(handle).toBeVisible();
  await handle.click();
  const menu = page.getByRole('menu', { name: /^Exit code 1/ });
  await expect(menu.getByRole('menuitem')).toHaveText(['Copy command', 'Copy output', 'Run again']);
  // The panel is at the window's bottom: the menu stays inside the window.
  const mb = (await menu.boundingBox())!;
  expect(mb.y + mb.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  // A command is still running: « Run again » waits.
  await expect(menu.getByRole('menuitem', { name: 'Run again' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // The build ends. A draft at the prompt: « Run again » waits too, it would run with it (review #299: « echo draft pnpm lint »).
  await emit(page, `✓ built in 2.1 s\r\n${ended(0)}${prompt('~/Workspace/ledge')}`);
  await expect(marks.locator('.shell-mark-line.running')).toHaveCount(0);
  await screenEl(page).locator('.xterm').click();
  await page.keyboard.type('echo draft ');
  await page.mouse.move(line!.x + 200, line!.y + line!.height / 2);
  await marks.locator('.shell-mark-handle').click();
  await expect(page.getByRole('menu', { name: /^Exit code 1/ }).getByRole('menuitem', { name: 'Run again' })).toBeDisabled();
  await page.keyboard.press('Escape');
  // An empty prompt: « Run again » types the failed command alone, without Enter: the person confirms it (E can be forged).
  await emit(page, `\r\n${prompt('~/Workspace/ledge')}`);
  const before = (await writes(page)).length;
  const moved = (await marks.locator('.shell-mark-line.failed').boundingBox())!;
  await page.mouse.move(moved.x + 200, moved.y + moved.height / 2);
  await marks.locator('.shell-mark-handle').click();
  await page.getByRole('menu', { name: /^Exit code 1/ }).getByRole('menuitem', { name: 'Run again' }).click();
  await expect.poll(async () => (await writes(page)).slice(before)).toBe('pnpm lint');

  // cd: the tab follows.
  await emit(page, `\r\n${o(`P;Cwd=${HOME}/Workspace/ledge/packages/ledge`)}`);
  await expect(panel(page).locator('.ide-btile-tab').first()).toHaveText(/^>_\s*WSL · Ubuntu 1 · ledge\/packages\/ledge$/);
});

// The real stream: dev-back's integration (feat/shell-integration 173362bd) for bash and fish in a tmux pane, recorded by a control
// client (%output) — e2e/osc633-<shell>.json, home renamed /home/otto. The client attached after the first prompt, as Desktop does
// after its opening screen: the first command has no marks (dev-back: a capture-pane screen carries none). zsh is not installed here.
for (const shell of ['bash', 'fish'] as const) {
  test(`the real stream through tmux (${shell}): failed, running, E unescaped, the tab following cd`, async ({ page }) => {
    const chunks = JSON.parse(readFileSync(new URL(`./osc633-${shell}.json`, import.meta.url), 'utf8')) as string[];
    await boot(page, 'light', 'en');
    for (const c of chunks) await emit(page, c);
    const marks = screenEl(page).locator('.shell-marks');
    // false (1), ls nope (2): a red mark each in the margin (the whole buffer); sleep 30: running, on screen.
    await expect(marks.locator('.shell-mark-fail')).toHaveCount(2);
    await expect(marks.locator('.shell-mark-line.running')).toHaveCount(1);
    // A margin mark scrolls to its command: its red line shows (fish's prompt takes a line more: they are above the panel).
    await marks.locator('.shell-mark-fail').first().click();
    await expect(marks.locator('.shell-mark-line.failed').first()).toBeVisible();
    await screenEl(page).locator('.xterm').click();
    await page.keyboard.press('Control+End');
    await expect(panel(page).locator('.ide-btile-tab').first()).toHaveText(/^>_\s*WSL · Ubuntu 1 · ledge\/packages\/ledge$/);
    // Ctrl ↑ from the running one up: echo 'a;bc' (E;echo 'a\x3bbc'), its command copied whole.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await screenEl(page).locator('.xterm').click();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+ArrowUp');
    await expect(marks.locator('.shell-mark-handle')).toHaveAccessibleName(/^Exit code 0/);
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Copy command' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("echo 'a;bc'");
  });
}

test('Ctrl ↑ / Ctrl ↓ go from one command to the next, Enter opens its menu', async ({ page }) => {
  await boot(page, 'light', 'en');
  await threeCommands(page);
  await screenEl(page).locator('.xterm').click();
  await page.keyboard.press('Control+ArrowUp');
  const marks = screenEl(page).locator('.shell-marks');
  await expect(marks.locator('.shell-mark-handle')).toBeFocused();
  await expect(marks.locator('.shell-mark-handle')).toHaveAccessibleName(/^Running/);
  await page.keyboard.press('Control+ArrowUp');
  await expect(marks.locator('.shell-mark-handle')).toHaveAccessibleName(/^Exit code 1/);
  await expect(marks.locator('.shell-mark-handle')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: /^Exit code 1/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // Neither key reached the shell.
  expect(await writes(page)).not.toContain('\x1b[1;5A');
});

for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['fr', 'en'] as const) {
    test(`captures, ${theme}, ${lang}`, async ({ page }, info) => {
      test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the marks');
      await boot(page, theme, lang);
      await threeCommands(page);
      await page.evaluate(() => document.fonts.ready);
      const bottom = panel(page);
      await bottom.screenshot({ path: info.outputPath(`marks-${theme}-${lang}.png`) });
      const line = await screenEl(page).locator('.shell-mark-line.failed').boundingBox();
      await page.mouse.move(line!.x + 200, line!.y + line!.height / 2);
      await page.waitForTimeout(200);
      await bottom.screenshot({ path: info.outputPath(`marks-hover-${theme}-${lang}.png`) });
      await screenEl(page).locator('.shell-mark-handle').click();
      await page.waitForTimeout(200);
      const vp = page.viewportSize()!;
      await page.screenshot({ path: info.outputPath(`marks-menu-${theme}-${lang}.png`), clip: { x: vp.width - 900, y: vp.height - 420, width: 900, height: 420 } });
    });
  }
}
