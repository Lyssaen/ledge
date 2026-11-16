import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsConfig } from '../src/config.js';

vi.mock('../src/app.js', () => ({ startAccountsRelay: async () => { throw new Error('migration exploded'); } }));
const { DatabaseUnreachableError, startRelay } = await import('../src/run.js');

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('startRelay migration failure', () => {
  it('is a DatabaseUnreachableError on pglite too, not a raw error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-mig-'));
    dirs.push(dir);
    const cfg: AccountsConfig = {
      mode: 'accounts', port: 0, database: { kind: 'pglite', dir: join(dir, 'db') }, clientId: 'id', clientSecret: 'secret',
      allowed: new Set(['1']), publicUrl: 'https://relay.example'
    };
    await expect(startRelay(cfg, { host: '127.0.0.1' })).rejects.toBeInstanceOf(DatabaseUnreachableError);
  });
});
