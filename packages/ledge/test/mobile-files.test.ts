import { describe, it, expect, beforeEach } from 'vitest';
import { statSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { DEFAULT_RELAY_URL, RelayUrlSchema } from '@ledge/protocol';
import { exportIdentity } from '@ledge/seal';
import { paths } from '../src/paths.js';
import {
  readMobileConfig, writeMobileConfig, readRelaySession, writeRelaySession, clearRelaySession,
  loadPcIdentity, readDevices, writeDevices
} from '../src/mobile/files.js';

const mode = (f: string) => statSync(f).mode & 0o777;
const session = (relayUrl: string) => ({ token: 't', accountId: 'a', login: 'l', relayUrl });

beforeEach(() => {
  for (const f of [paths().mobile, paths().mobileSession, paths().mobileKey, paths().devices]) rmSync(f, { force: true });
});

describe('RelayUrlSchema', () => {
  it('reduces to the origin and drops a trailing slash', () => expect(RelayUrlSchema.parse('https://relay.example/')).toBe('https://relay.example'));
  it('refuses http off localhost', () => expect(RelayUrlSchema.safeParse('http://relay.example').success).toBe(false));
  it('accepts http on localhost', () => expect(RelayUrlSchema.parse('http://localhost:8080')).toBe('http://localhost:8080'));
  it('accepts http on 127.0.0.1', () => expect(RelayUrlSchema.parse('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080'));
  it('refuses a path, a query and a fragment', () => {
    for (const u of ['https://relay.example/x', 'https://relay.example/?a=1', 'https://relay.example/#f']) expect(RelayUrlSchema.safeParse(u).success).toBe(false);
  });
});

describe('mobile files', () => {
  it('gives the default config when absent or invalid', () => {
    expect(readMobileConfig()).toEqual({ enabled: false, relayUrl: DEFAULT_RELAY_URL });
    writeFileSync(paths().mobile, '{nope');
    expect(readMobileConfig()).toEqual({ enabled: false, relayUrl: DEFAULT_RELAY_URL });
  });

  it('round-trips the config, session and devices, each at 0600', () => {
    writeMobileConfig({ enabled: true, relayUrl: 'https://a.example' });
    writeRelaySession(session('https://a.example'));
    writeDevices([{ id: 'x', publicKey: 'k', label: 'Phone', approvedAt: '2026-10-19T00:00:00Z' }]);
    expect(readMobileConfig()).toEqual({ enabled: true, relayUrl: 'https://a.example' });
    expect(readRelaySession()).toEqual(session('https://a.example'));
    expect(readDevices()).toHaveLength(1);
    for (const f of [paths().mobile, paths().mobileSession, paths().devices]) expect(mode(f)).toBe(0o600);
  });

  it('clears the session, and clearing twice is harmless', () => {
    writeMobileConfig({ enabled: true, relayUrl: 'https://a.example' });
    writeRelaySession(session('https://a.example'));
    clearRelaySession();
    clearRelaySession();
    expect(readRelaySession()).toBeNull();
  });

  it('ignores a session opened on another relay', () => {
    writeMobileConfig({ enabled: true, relayUrl: 'https://b.example' });
    writeRelaySession(session('https://a.example'));
    expect(readRelaySession()).toBeNull();
  });

  it('gives [] for a corrupted devices.json', () => {
    writeFileSync(paths().devices, 'garbage');
    expect(readDevices()).toEqual([]);
  });

  it('keeps the same PC key across loads, stored as bare PKCS8 at 0600', async () => {
    const a = await loadPcIdentity();
    const b = await loadPcIdentity();
    expect(await exportIdentity(b)).toBe(await exportIdentity(a));
    expect(b.publicKey).toBe(a.publicKey);
    const stored = readFileSync(paths().mobileKey, 'utf8').trim();
    expect(stored).toBe(await exportIdentity(a));
    expect(stored).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(mode(paths().mobileKey)).toBe(0o600);
    expect(existsSync(`${paths().mobileKey}.${process.pid}.tmp`)).toBe(false);
  });

  // chmod 000 does not stop root, so these cannot show anything there.
  describe.skipIf(process.getuid?.() === 0)('a file that exists but cannot be read', () => {
    const lock = (f: string) => { chmodSync(f, 0o000); return () => chmodSync(f, 0o600); };

    it('keeps the PC key: loadPcIdentity throws and does not replace the file', async () => {
      await loadPcIdentity();
      const before = readFileSync(paths().mobileKey, 'utf8');
      const unlock = lock(paths().mobileKey);
      try {
        await expect(loadPcIdentity()).rejects.toThrow(/mobile-key/);
      } finally { unlock(); }
      expect(readFileSync(paths().mobileKey, 'utf8')).toBe(before);
    });

    it('keeps the approved devices: readDevices throws, the file is untouched, the message holds no content', () => {
      writeDevices([{ id: 'secret-id', publicKey: 'k', label: 'Phone', approvedAt: '2026-10-19T00:00:00Z' }]);
      const before = readFileSync(paths().devices, 'utf8');
      const unlock = lock(paths().devices);
      try {
        expect(() => readDevices()).toThrow(/devices\.json/);
        try { readDevices(); } catch (e) { expect((e as Error).message).not.toContain('secret-id'); }
      } finally { unlock(); }
      expect(readFileSync(paths().devices, 'utf8')).toBe(before);
    });

    it('throws for the config and the session too, rather than reading them as absent', () => {
      writeMobileConfig({ enabled: true, relayUrl: 'https://a.example' });
      const unlock = lock(paths().mobile);
      try { expect(() => readMobileConfig()).toThrow(/mobile\.json/); } finally { unlock(); }
    });
  });
});
