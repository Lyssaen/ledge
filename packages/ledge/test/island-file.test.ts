import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ISLAND_PREFS, DEFAULT_MUSIC_PREFS } from '@ledge/protocol';
import { readIsland } from '../src/daemon/island.js';

describe('readIsland', () => {
  it('a file written before music reads with music off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-island-'));
    const file = join(dir, 'island.json');
    const { music: _, ...old } = DEFAULT_ISLAND_PREFS;
    writeFileSync(file, JSON.stringify(old));
    expect(readIsland(file)?.music).toEqual(DEFAULT_MUSIC_PREFS);
  });
});
