import { expect, test } from '@playwright/test';
import { hasWebkit } from './webkit';

test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');

test('an identity stored by indexedDbKeys() survives a reload, stays non-extractable and still completes a handshake', async ({ page }) => {
  await page.goto('/e2e/keys.html');
  await page.waitForFunction(() => (window as any).keysReady === true);
  const stored = await page.evaluate(() => (window as any).storeFresh());
  expect(stored.extractable).toBe(false);

  await page.reload();
  await page.waitForFunction(() => (window as any).keysReady === true);
  const r = await page.evaluate(() => (window as any).reloadAndHandshake());
  expect(r.publicKey).toBe(stored.publicKey);
  expect(r.extractable).toBe(false);
  expect(r.exportRefused).toBe(true);
  expect(r.opened).toEqual({ atPc: '{"t":"ready"}', atDevice: '{"t":"ready"}' });
  expect(r.afterForget).toBeNull();
});

test('a PC pinned in IndexedDB survives a reload; forget() then drops it, the identity and ledge.mobile.*', async ({ page }) => {
  await page.goto('/e2e/keys.html');
  await page.waitForFunction(() => (window as any).keysReady === true);
  const pc = await page.evaluate(() => (window as any).pinFresh());

  await page.reload();
  await page.waitForFunction(() => (window as any).keysReady === true);
  const r = await page.evaluate(() => (window as any).reloadPinnedAndForget());
  expect(r.pinned).toEqual(pc);
  expect(r.hadIdentity).toBe(true);
  expect(r.afterForget).toEqual({ pinned: null, identity: null });
  expect(r.storage).toEqual({ mobile: null, other: 'kept' });
});

test('two stores racing on ensureIdentity end with one stored identity, returned to both', async ({ page }) => {
  await page.goto('/e2e/keys.html');
  await page.waitForFunction(() => (window as any).keysReady === true);
  const r = await page.evaluate(() => (window as any).twoStoresRace());
  expect(r.b).toBe(r.a);
  expect(r.stored).toBe(r.a);
});
