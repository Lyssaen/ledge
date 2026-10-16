import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

test('selecting a session opens its pane with the header and the actions', async ({ page }) => {
  const daemon = await fakeDaemon(page, eight);
  await page.goto('/');
  await page.locator('.seat[data-session="local:luna"]').click();
  const pane = page.locator('#conversation-pane');
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('heading', { level: 3 })).toBeVisible();
  await expect(pane.locator('.conversation-person strong')).toHaveText('Luna');
  const actions = pane.getByRole('group', { name: 'Session actions' });
  await expect(actions.getByRole('button', { name: 'Open terminal' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Rename' })).toBeVisible();
  await expect(pane.locator('details.conversation-meta')).not.toHaveAttribute('open', '');
  await pane.getByText('Session details').click();
  await expect(pane.locator('.detail-meta')).toBeVisible();
  // Stop asks first, then sends once.
  const stop = actions.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(pane.locator('.conversation-confirm')).toBeVisible();
  await pane.getByRole('button', { name: 'Cancel' }).click();
  await expect(pane.locator('.conversation-confirm')).toHaveCount(0);
  expect(daemon.received.some(m => m.type === 'session.kill')).toBe(false);
  await stop.click();
  await pane.getByRole('button', { name: 'Yes, stop' }).click();
  await expect.poll(() => daemon.received.some(m => m.type === 'session.kill' && m.id === 'luna')).toBe(true);
  await actions.getByRole('button', { name: 'Rename' }).click();
  const input = pane.getByRole('textbox', { name: 'Session subject' });
  await input.fill('Brand new subject');
  await input.press('Enter');
  await expect.poll(() => daemon.received.some(m => m.type === 'session.rename' && m.topic === 'Brand new subject')).toBe(true);
});

test('Open terminal calls the native open_terminal command', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as Record<string, unknown>).__terminalCalls = calls;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown) => { calls.push({ cmd, args }); return cmd === 'focus_terminal' ? false : cmd === 'open_terminal'; },
      transformCallback: () => 0, unregisterListener: () => {}
    };
  });
  const daemon = await fakeDaemon(page, eight, { launcher: ['ledge'] });
  await page.goto('/');
  await page.locator('.seat[data-session="local:luna"]').click();
  await page.locator('#conversation-pane').getByRole('button', { name: 'Open terminal' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __terminalCalls: { cmd: string }[] }).__terminalCalls.map(c => c.cmd))).toContain('open_terminal');
  const open = await page.evaluate(() => (window as unknown as { __terminalCalls: { cmd: string; args: { command: string[] } }[] }).__terminalCalls.find(c => c.cmd === 'open_terminal')!.args.command);
  expect(open.slice(-2)).toEqual(['attach', expect.stringContaining('luna')]);
  expect(daemon.received.some(m => m.type === 'session.focus' && m.id === 'luna')).toBe(true);
  await expect(page.locator('.conversation-note')).toHaveCount(0);
});
