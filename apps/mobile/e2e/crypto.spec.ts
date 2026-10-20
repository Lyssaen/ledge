import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const v = JSON.parse(readFileSync(new URL('../../../packages/seal/test/vectors.json', import.meta.url), 'utf8'));

test('the browser derives the same keys, code and sealed frames as Node, and refuses an off-curve point', async ({ page }) => {
  await page.goto('/e2e/crypto.html');
  await page.waitForFunction(() => (window as any).vectorsReady === true);
  const r = await page.evaluate(() => (window as any).runVectors());
  expect(r.pcPublicKey).toBe(v.pc.publicKey);
  expect(r.devicePublicKey).toBe(v.device.publicKey);
  expect(r.pcFingerprint).toBe(v.expected.pcFingerprint);
  expect(r.deviceFingerprint).toBe(v.expected.deviceFingerprint);
  expect(r.commit).toBe(v.expected.commit);
  expect(r.pairingCode).toBe(v.expected.pairingCode);
  expect(r.sealed).toEqual(v.expected.sealed);
  expect(r.opened).toEqual({ atDevice: '{"t":"ready"}', atPc: '{"t":"ready"}' });
  expect(r.offCurveImport).toBe('bad_key');
  expect(r.offCurveHandshake).toBe('bad_key');
});
