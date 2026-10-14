import { test, expect, expectMode, layer, ready } from './fixtures';
import { fakeDaemon } from './daemon';
import { openList, overview } from './scenarios';

const origin = 'https://pc.tail.ts.net';
const device = (id: string, name: string, lastSeenAt?: string) => ({ id, name, createdAt: new Date(Date.now() - 86_400_000).toISOString(), hasKey: true, ...(lastSeenAt ? { lastSeenAt } : {}) });

test('Settings > Mobile lists phones, pairs with a code and removes a phone in one click', async ({ page }) => {
  const d = await fakeDaemon(page, overview());
  await ready(page, 4);
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
  await expectMode(page, 'settings');
  const settings = layer(page, 'settings');
  await settings.getByRole('tab', { name: 'Mobile' }).click();
  await expect.poll(() => d.received).toContainEqual({ type: 'devices' });

  d.emit({ type: 'devices', devices: [], origin: null, listening: false });
  await expect(settings.getByText('ledge mobile enable --origin https://<machine>.<tailnet>.ts.net')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Pair a phone' })).toHaveCount(0);

  d.emit({ type: 'devices', devices: [device('a', 'iPhone de Joffrey', new Date(Date.now() - 180_000).toISOString())], origin, listening: true });
  await settings.getByRole('button', { name: 'Pair a phone' }).click();
  await expect.poll(() => d.received).toContainEqual({ type: 'pair.begin' });
  d.emit({ type: 'pair.code', code: '481203', expiresAt: new Date(Date.now() + 120_000).toISOString(), url: `${origin}/m/#/pair` });
  await expect(settings.getByRole('img', { name: `${origin}/m/#/pair` })).toBeVisible();
  await expect(settings.getByText('481 203')).toBeVisible();
  await expect(settings.getByRole('timer')).toContainText('Expires in');
  await page.screenshot({ path: 'e2e/.results/mobile-settings.png' });

  // The phone pairs: a new device consumes the code and the view returns to the list.
  d.emit({ type: 'devices', devices: [device('a', 'iPhone de Joffrey'), device('b', 'iPad')], origin, listening: true });
  await expect(settings.getByText('481 203')).toHaveCount(0);
  await expect(settings.getByText('iPad')).toBeVisible();

  await settings.getByRole('button', { name: 'Remove iPad' }).click();
  await expect.poll(() => d.received).toContainEqual({ type: 'device.revoke', id: 'b' });
});
