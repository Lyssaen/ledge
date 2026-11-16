import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ESM script without types
import { relayPublishable, checkRelayPack } from '../scripts/relay-pack.mjs';

const ALL = ['dist/cli.js', 'dist/main.js', 'web/index.html', 'web/sw.js', 'web/build.json', 'web/manifest.webmanifest', 'web/assets/x.js'];

describe('relayPublishable', () => {
  it('is false without a licence or while UNLICENSED', () => {
    expect(relayPublishable({ license: 'UNLICENSED' })).toBe(false);
    expect(relayPublishable({})).toBe(false);
    expect(relayPublishable({ license: '' })).toBe(false);
  });
  it('is true with a real licence', () => expect(relayPublishable({ license: 'MIT' })).toBe(true));
});

describe('checkRelayPack', () => {
  it('finds nothing wrong with a whole package', () => {
    expect(checkRelayPack({ files: ALL, packedBuild: 'a', mobileBuild: 'a' })).toEqual([]);
  });
  it('names a missing file', () => {
    const p = checkRelayPack({ files: ALL.filter((f) => f !== 'web/build.json'), packedBuild: 'a', mobileBuild: 'a' });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/web\/build\.json/);
  });
  it('reports a packed build that is not the phone build', () => {
    expect(checkRelayPack({ files: ALL, packedBuild: 'a', mobileBuild: 'b' })).toHaveLength(1);
  });
});
