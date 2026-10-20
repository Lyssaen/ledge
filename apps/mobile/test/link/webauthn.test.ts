import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssertionSchema, CredentialSchema } from '@ledge/protocol';
import { createCredential, getAssertion, platformAvailable } from '../../src/link/webauthn';

const buf = (...n: number[]) => new Uint8Array(n).buffer;

afterEach(() => { vi.unstubAllGlobals(); });

function stub(credentials: { create?: (o: unknown) => unknown; get?: (o: unknown) => unknown }, pkc?: unknown) {
  vi.stubGlobal('navigator', { credentials });
  vi.stubGlobal('PublicKeyCredential', pkc);
}

const created = (over: Record<string, unknown> = {}) => ({
  rawId: buf(251, 255, 1),
  response: {
    clientDataJSON: buf(1, 2, 3),
    getAuthenticatorData: () => buf(4, 5),
    getPublicKey: () => buf(6, 7, 8, 9),
    getPublicKeyAlgorithm: () => -7,
    getTransports: () => ['internal'],
    ...over
  }
});

const asserted = () => ({
  rawId: buf(251, 255, 1),
  response: { clientDataJSON: buf(1, 2), authenticatorData: buf(3), signature: buf(255, 254) }
});

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('platformAvailable', () => {
  it('asks the browser, and is false without the API or on an error', async () => {
    stub({}, { isUserVerifyingPlatformAuthenticatorAvailable: async () => true });
    expect(await platformAvailable()).toBe(true);
    stub({}, undefined);
    expect(await platformAvailable()).toBe(false);
    stub({}, { isUserVerifyingPlatformAuthenticatorAvailable: async () => { throw new Error('boom'); } });
    expect(await platformAvailable()).toBe(false);
  });
});

describe('createCredential', () => {
  it('asks for a platform passkey with user verification and returns base64url fields', async () => {
    const create = vi.fn(async () => created());
    stub({ create });
    const c = await createCredential({ challenge: 'AQID', rpId: 'relay.example' }, { label: 'iPhone de Kai' });
    expect(c).toEqual({ id: '-_8B', publicKey: 'BgcICQ', alg: -7, clientDataJSON: 'AQID', authenticatorData: 'BAU', transports: ['internal'] });
    expect(CredentialSchema.safeParse(c).success).toBe(true);
    const { publicKey: o } = (create.mock.calls[0] as unknown as [{ publicKey: Record<string, any> }])[0];
    expect([...new Uint8Array(o.challenge)]).toEqual([1, 2, 3]);
    expect(o.rp).toEqual({ id: 'relay.example', name: 'Ledge' });
    expect(o.user.name).toBe('iPhone de Kai');
    expect(o.user.id.byteLength ?? o.user.id.length).toBe(16);
    expect(o.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }]);
    expect(o.authenticatorSelection).toEqual({ authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' });
    expect(o.attestation).toBe('none');
    expect(o.timeout).toBe(60_000);
  });

  it('is unsupported when the browser gives no public key or algorithm', async () => {
    stub({ create: async () => created({ getPublicKey: () => null }) });
    expect(await createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).toBe('unsupported');
    stub({ create: async () => created({ getPublicKeyAlgorithm: () => null }) });
    expect(await createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).toBe('unsupported');
    stub({ create: async () => created({ getPublicKey: undefined }) });
    expect(await createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).toBe('unsupported');
    stub({ create: async () => created({ getPublicKeyAlgorithm: () => -8 }) });
    expect(await createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).toBe('unsupported');
  });

  it('is unsupported without navigator.credentials', async () => {
    vi.stubGlobal('navigator', {});
    expect(await createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).toBe('unsupported');
  });

  it('is cancelled, without throwing, on NotAllowedError or AbortError', async () => {
    for (const name of ['NotAllowedError', 'AbortError']) {
      stub({ create: async () => { throw domError(name); } });
      expect(await createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).toBe('cancelled');
    }
  });

  it('lets another failure through', async () => {
    stub({ create: async () => { throw domError('SecurityError'); } });
    await expect(createCredential({ challenge: 'AQID', rpId: 'r' }, { label: 'x' })).rejects.toThrow('SecurityError');
  });
});

describe('getAssertion', () => {
  it('names the credential, requires user verification and returns base64url fields', async () => {
    const get = vi.fn(async () => asserted());
    stub({ get });
    const a = await getAssertion({ challenge: 'AQID', rpId: 'relay.example', credentialId: '-_8B' });
    expect(a).toEqual({ id: '-_8B', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: '__4' });
    expect(AssertionSchema.safeParse(a).success).toBe(true);
    const { publicKey: o } = (get.mock.calls[0] as unknown as [{ publicKey: Record<string, any> }])[0];
    expect([...new Uint8Array(o.challenge)]).toEqual([1, 2, 3]);
    expect(o.rpId).toBe('relay.example');
    expect(o.userVerification).toBe('required');
    expect(o.allowCredentials).toHaveLength(1);
    expect(o.allowCredentials[0].type).toBe('public-key');
    expect([...new Uint8Array(o.allowCredentials[0].id)]).toEqual([251, 255, 1]);
  });

  it('is cancelled on NotAllowedError or AbortError, and when the browser gives nothing', async () => {
    for (const name of ['NotAllowedError', 'AbortError']) {
      stub({ get: async () => { throw domError(name); } });
      expect(await getAssertion({ challenge: 'AQID', rpId: 'r', credentialId: 'AQ' })).toBe('cancelled');
    }
    stub({ get: async () => null });
    expect(await getAssertion({ challenge: 'AQID', rpId: 'r', credentialId: 'AQ' })).toBe('cancelled');
  });
});
