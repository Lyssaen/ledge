import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { at, fleet, ottoThread } from './thread';

test('a pasted image rides the reply, shows as a thumbnail, opens and saves', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, threads: { nova: ottoThread.map(i => ({ ...i })) } });
  await page.goto('/'); await openAtelier(page);
  await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).click();
  const field = page.getByRole('textbox', { name: 'Reply to the agent' });
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
  await page.getByRole('button', { name: 'Send' }).click();

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
