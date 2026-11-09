// review-qa's reproduction of two read-only regressions (review of 77f9dbd3), kept as their guard.
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon } from './daemon';
import { fleet } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

test('mouse protocol survives a read-only visit', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'] });
  await page.goto('/');
  await page.evaluate(async () => {
    const src = '/src/term/surface.ts'; const { createSurface } = await import(/* @vite-ignore */ src) as typeof import('../src/term/surface');
    const s = createSurface({ theme: {}, onThread() {}, openUrl() {} });
    Object.assign(s.host.style, { position: 'fixed', zIndex: '99999', top: '0', left: '0', width: '800px', height: '400px', background: 'black' });
    document.body.append(s.host);
    s.fit();
    const w = window as any;
    w.reviewSurface = s;
    w.reviewInput = [];
    s.onInput((d: string) => w.reviewInput.push(d));
    s.write('\x1b[?1000h\x1b[?1003h\x1b[?1000h\x1b[?1006hHELLO');
  });
  await page.waitForTimeout(500);
  const screen = page.locator('[data-terminal] .xterm-screen').last();
  const box = (await screen.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.move(box.x + 50, box.y + 20);
  expect(await page.evaluate(() => (window as any).reviewInput)).toEqual([]);
  await page.evaluate(() => (window as any).reviewSurface.setReadOnly(true));
  await page.waitForTimeout(100);
  await page.evaluate(() => (window as any).reviewSurface.setReadOnly(false));
  await page.waitForTimeout(200);
  await page.mouse.move(box.x + 80, box.y + 20);
  await page.mouse.move(box.x + 100, box.y + 20);
  expect(await page.evaluate(() => (window as any).reviewInput)).toEqual([]);
});

test('combined mouse and alternate screen modes precede following text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeDaemon(page, fleet, { launcher: ['ledge'] });
  await page.goto('/');
  await page.evaluate(async () => {
    const src = '/src/term/surface.ts'; const { createSurface } = await import(/* @vite-ignore */ src) as typeof import('../src/term/surface');
    const s = createSurface({ theme: {}, onThread() {}, openUrl() {} });
    Object.assign(s.host.style, { position: 'fixed', zIndex: '99999', top: '0', left: '0', width: '800px', height: '400px', background: 'black' });
    document.body.append(s.host); s.fit();
    (window as any).reviewSurface = s;
    s.setReadOnly(true);
    s.write('\x1b[?1003;1049hHELLO-REVIEW');
    await navigator.clipboard.writeText('before');
  });
  await page.waitForTimeout(500);
  const screen = page.locator('[data-terminal] .xterm-screen').last();
  const box = (await screen.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 6, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('HELLO-REVIEW');
});
