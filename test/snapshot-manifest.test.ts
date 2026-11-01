import { describe, expect, it } from 'vitest';
import { snapshotManifest } from '../scripts/snapshot-manifest.mjs';

describe('snapshot updater manifest', () => {
  const input = { version: '0.29.0-snapshot.1234.2', signature: ' signed\n', pubDate: '2026-11-01T00:00:00Z' };
  it('publishes the signed snapshot installer at the rolling URL', () => {
    const result = snapshotManifest(input);
    expect(result.version).toBe(input.version);
    expect(result.platforms['windows-x86_64']).toEqual({ signature: 'signed', url: 'https://github.com/Lyssaen/ledge/releases/download/snapshot/Ledge.Desktop.Snapshot-x64-setup.exe' });
  });
  it('rejects versions without a unique snapshot identifier and missing signatures', () => {
    for (const version of ['0.29.0', '0.29.0-snapshot.0.1', 'latest', '0.29.0-snapshot.1']) expect(() => snapshotManifest({ ...input, version })).toThrow();
    expect(() => snapshotManifest({ ...input, signature: ' ' })).toThrow();
  });
});
