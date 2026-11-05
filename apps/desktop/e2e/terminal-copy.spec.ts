import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { fleet } from './thread';

// Copying from a terminal (C1–C3): a program's own OSC 52 copy, and Shift + drag over a program that holds the mouse.
test.setTimeout(90_000);
const emit = (page: Page, text: string) => page.evaluate(t => (window as unknown as { __ledgePtyEmit: (s: string) => void }).__ledgePtyEmit(t), text);
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites.join(''));

test.beforeEach(async ({ context }) => { await context.grantPermissions(['clipboard-read', 'clipboard-write']); });

test('a program\'s OSC 52 lands in the clipboard; Shift + drag selects over its mouse, Ctrl C copies', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).click();
  await expect(page.locator('.session-page')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-terminal]'))).toBe(true);
  await page.evaluate(() => navigator.clipboard.writeText('avant'));

  // C1: the program copies by itself (Claude Code's selection does this), UTF-8 kept. A read is not answered.
  const b64 = Buffer.from('copié par le programme ✻').toString('base64');
  await emit(page, `\x1b]52;c;${b64}\x07`);
  await expect.poll(() => clipboard(page)).toBe('copié par le programme ✻');
  const before = await writes(page);
  await emit(page, '\x1b]52;c;?\x07');
  await page.waitForTimeout(200);
  expect(await writes(page)).toBe(before);

  // C2: the program takes the mouse (as Claude Code does): a plain drag reaches it, not the selection.
  await emit(page, '\x1b[?1003h\x1b[?1006h\x1b[2J\x1b[1;1HSELECT-ME-PLEASE');
  const screen = page.locator('.agent-view .xterm-screen');
  const box = (await screen.boundingBox())!;
  // WebGL draws the rows (none in the DOM): the text sits on the first one, a few pixels under the screen's top.
  const y = box.y + 6;
  const drag = async (shift: boolean) => {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, y, { steps: 4 });
    await page.mouse.move(box.x + 160, y, { steps: 4 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  await drag(false);
  await expect.poll(() => writes(page)).toContain('\x1b[<');
  await page.keyboard.press('Control+Shift+C');
  await expect.poll(() => clipboard(page)).toBe('copié par le programme ✻');

  await drag(true);
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboard(page)).toMatch(/^SELECT-ME/);
  // The copy went to the clipboard, not to the program as an interrupt.
  expect(await writes(page)).not.toContain('\x03');
});
