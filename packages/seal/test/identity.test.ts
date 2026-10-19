import { describe, expect, it } from 'vitest';
import {
  SealError,
  b64u,
  exportIdentity,
  fromB64u,
  generateIdentity,
  importIdentity,
  importPublicKey,
} from '../src/index.js';

describe('identity', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63]);
    expect(b64u(bytes)).toBe('APv_Pj8');
    expect(fromB64u(b64u(bytes))).toEqual(bytes);
    expect(() => fromB64u('a+b/')).toThrow(SealError);
  });
  it('refuses non-zero leftover bits', () => {
    expect(fromB64u('AA')).toEqual(new Uint8Array([0]));
    expect(fromB64u('AAA')).toEqual(new Uint8Array([0, 0]));
    expect(() => fromB64u('AB')).toThrow(expect.objectContaining({ code: 'bad_encoding' }));
    expect(() => fromB64u('AAB')).toThrow(expect.objectContaining({ code: 'bad_encoding' }));
    expect(() => fromB64u('APv_Pj9')).toThrow(expect.objectContaining({ code: 'bad_encoding' }));
  });
  it('generates a non-extractable P-256 identity by default', async () => {
    const id = await generateIdentity();
    expect(fromB64u(id.publicKey)).toHaveLength(65);
    expect(fromB64u(id.publicKey)[0]).toBe(4);
    await expect(crypto.subtle.exportKey('pkcs8', id.privateKey)).rejects.toThrow();
    await expect(exportIdentity(id)).rejects.toThrow();
  });
  it('exports and re-imports an extractable identity', async () => {
    const id = await generateIdentity({ extractable: true });
    const back = await importIdentity(await exportIdentity(id), id.publicKey);
    expect(back.publicKey).toBe(id.publicKey);
  });
  it('refuses a malformed public key', async () => {
    await expect(importPublicKey(b64u(new Uint8Array(65)))).rejects.toMatchObject({ code: 'bad_key' });
    await expect(importPublicKey(b64u(new Uint8Array(33).fill(2)))).rejects.toMatchObject({ code: 'bad_key' });
  });
});
