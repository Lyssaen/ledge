import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { ideReady, openSession, pane } from './ide';
import { at, fleet, ottoThread, tool } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

test('a pasted image rides the reply, shows as a thumbnail, opens and saves', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: ottoThread.map(i => ({ ...i })) } });
  await page.goto('/'); await ideReady(page);
  await openSession(page, 'Nova');
  const field = pane(page, 'Nova').getByRole('textbox', { name: 'Reply to the agent' });
  await field.click();
  // A synthetic paste: a PNG drawn on a canvas, carried by a DataTransfer like the clipboard's.
  await field.evaluate(async el => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 40;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, 64, 40); ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 20, 12);
    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await field.fill('Regarde cette capture');
  // The IDE's reply has no Send button: Enter sends.
  await field.press('Enter');

  await expect.poll(() => daemon.received.filter(m => m.type === 'session.reply').length).toBe(1);
  const reply = daemon.received.find(m => m.type === 'session.reply')!;
  if (reply.type !== 'session.reply') throw new Error('unreachable');
  expect(reply.text).toBe('Regarde cette capture');
  expect(reply.attachments).toHaveLength(1);
  const id = reply.attachments![0]!;

  // The daemon echoes the prompt with the stored ref.
  const stored = daemon.stored(id);
  daemon.item('nova', { kind: 'prompt', id: 'prompt-img', at: at(-1), turn: 3, text: 'Regarde cette capture', images: [stored] });
  const thumb = page.locator('.prompt-images').getByRole('button').first();
  await expect(thumb).toBeVisible();
  await thumb.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Capture · You');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Save…' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^capture-\d{4}\.(png|jpg|webp)$/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a capture opens the Navigateur tab', async ({ page }) => {
  // An 8 × 5 PNG the daemon holds, on a Playwright screenshot row after a navigation that names the page.
  const id = 'c'.repeat(64);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAIAAAD38zoCAAAAEUlEQVR4nGMwTjuDFTHQQQIAh6w3yVmZr3wAAAAASUVORK5CYII=';
  const thread = [
    ...ottoThread.map(i => ({ ...i })),
    tool('nav-1', -10, 'mcp__playwright__browser_navigate', 'localhost:5173', { output: '- Page URL: http://localhost:5173/\n- Page Title: Factur' }),
    tool('shot-1', -5, 'mcp__playwright__browser_take_screenshot', 'viewport', { images: [{ id, mime: 'image/png', width: 1280, height: 800, bytes: 90, preview: false }] })
  ];
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: thread }, images: { [id]: { mime: 'image/png', data: png } } });
  await page.goto('/'); await ideReady(page);
  await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).click();

  const thumb = page.locator('[data-tool="shot-1"] [data-thumb="ready"]');
  await expect(thumb).toBeVisible();
  await thumb.click();
  const pane = page.getByRole('complementary', { name: 'Reading pane' });
  await expect(pane.locator('.side-title strong')).toHaveText('Browser');
  await expect(pane.locator('.browser-meta')).toContainText('localhost:5173/');
  const big = pane.locator('.browser-big img');
  await expect(big).toBeVisible();
  await expect.poll(() => big.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(8);
  await expect(pane.locator('[data-capture="shot-1:0"]')).toHaveAttribute('aria-current', 'true');
});
