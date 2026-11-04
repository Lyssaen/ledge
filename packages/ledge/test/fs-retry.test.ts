import { describe, expect, it } from 'vitest';
import { renameRetry } from '../src/fs-retry.js';

const err = (code: string) => Object.assign(new Error(code), { code });

// Windows: an antivirus or an indexer briefly holds a file a journal write replaces.
describe('renameRetry', () => {
  it('retries a held file, then succeeds', async () => {
    let n = 0;
    await renameRetry('a', 'b', { delayMs: 1, rename: async () => { n++; if (n < 3) throw err('EPERM'); } });
    expect(n).toBe(3);
  });
  it('gives up after its tries with the error as is', async () => {
    let n = 0;
    await expect(renameRetry('a', 'b', { delayMs: 1, rename: async () => { n++; throw err('EBUSY'); } })).rejects.toMatchObject({ code: 'EBUSY' });
    expect(n).toBe(6);
  });
  it('does not retry another error', async () => {
    let n = 0;
    await expect(renameRetry('a', 'b', { delayMs: 1, rename: async () => { n++; throw err('ENOENT'); } })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(n).toBe(1);
  });
});
