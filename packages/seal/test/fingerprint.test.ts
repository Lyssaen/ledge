import { describe, expect, it } from 'vitest';
import { fingerprint, generateIdentity } from '../src/index.js';

describe('fingerprint', () => {
  it('is 22 base64url characters, stable, and key specific', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const fa = await fingerprint(a.publicKey);
    expect(fa).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await fingerprint(a.publicKey)).toBe(fa);
    expect(await fingerprint(b.publicKey)).not.toBe(fa);
  });
  it('refuses an invalid point', async () => {
    await expect(fingerprint('AAAA')).rejects.toMatchObject({ code: 'bad_key' });
  });
});
