import { PGlite } from '@electric-sql/pglite';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.js';
import { Store } from '../src/store.js';

interface Backend {
  open(): Promise<Db>;
}

const pglite: Backend = {
  async open() {
    const db = new PGlite();
    cleanups.push(() => db.close());
    return db;
  }
};

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const postgres: Backend = {
  async open() {
    const client = new pg.Client({ connectionString: process.env.LEDGE_RELAY_TEST_DATABASE_URL });
    await client.connect();
    const schema = `t_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    cleanups.push(async () => {
      try {
        await client.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await client.end();
      }
    });
    return client;
  }
};

const DEVICE = 'd_AAAAAAAAAAAAAAAAAAAAAA';

function suite(name: string, backend: Backend, skip: boolean) {
  // A fresh PGlite instance takes several seconds to boot on a slow machine.
  describe.skipIf(skip)(name, { timeout: 30_000 }, () => {
    async function make(opts?: ConstructorParameters<typeof Store>[1]) {
      const store = new Store(await backend.open(), opts);
      await store.migrate();
      return store;
    }

    it('migrate can run twice', async () => {
      const store = await make();
      await expect(store.migrate()).resolves.toBeUndefined();
    });

    it('returns a created session with the account login, which upsertAccount updates', async () => {
      const store = await make();
      await store.upsertAccount('583231', 'kruril');
      await store.createSession('h1', { accountId: '583231', login: 'kruril', peer: 'pc', kind: 'pc' });
      expect(await store.findSession('h1')).toEqual({ accountId: '583231', login: 'kruril', peer: 'pc', kind: 'pc' });
      await store.upsertAccount('583231', 'renamed');
      expect((await store.findSession('h1'))?.login).toBe('renamed');
    });

    it('keeps big github ids as decimal strings', async () => {
      const store = await make();
      const id = '9007199254740993';
      await store.upsertAccount(id, 'big');
      await store.createSession('h', { accountId: id, login: 'big', peer: DEVICE, kind: 'device' });
      expect(await store.findSession('h')).toEqual({ accountId: id, login: 'big', peer: DEVICE, kind: 'device' });
    });

    it('slides the expiry on each lookup and expires an idle session', async () => {
      let t = 0;
      const store = await make({ now: () => t, ttlMs: 1000 });
      await store.upsertAccount('1', 'a');
      await store.createSession('h', { accountId: '1', login: 'a', peer: 'pc', kind: 'pc' });
      t = 900;
      expect(await store.findSession('h')).not.toBeNull();
      t = 1800;
      expect(await store.findSession('h')).not.toBeNull();
      t = 2901;
      expect(await store.findSession('h')).toBeNull();
    });

    it('revokeSession returns the session once, then null', async () => {
      const store = await make();
      await store.upsertAccount('1', 'a');
      const s = { accountId: '1', login: 'a', peer: DEVICE, kind: 'device' as const };
      await store.createSession('h', s);
      expect(await store.revokeSession('h')).toEqual(s);
      expect(await store.findSession('h')).toBeNull();
      expect(await store.revokeSession('h')).toBeNull();
    });

    it('revokeSessions revokes only that account and kind', async () => {
      const store = await make();
      await store.upsertAccount('1', 'a');
      await store.upsertAccount('2', 'b');
      await store.createSession('a-pc', { accountId: '1', login: 'a', peer: 'pc', kind: 'pc' });
      await store.createSession('a-pc2', { accountId: '1', login: 'a', peer: 'pc', kind: 'pc' });
      await store.createSession('a-dev', { accountId: '1', login: 'a', peer: DEVICE, kind: 'device' });
      await store.createSession('b-pc', { accountId: '2', login: 'b', peer: 'pc', kind: 'pc' });
      expect(await store.revokeSessions('1', 'pc')).toBe(2);
      expect(await store.findSession('a-pc')).toBeNull();
      expect(await store.findSession('a-pc2')).toBeNull();
      expect(await store.findSession('a-dev')).not.toBeNull();
      expect(await store.findSession('b-pc')).not.toBeNull();
      expect(await store.revokeSessions('1', 'pc')).toBe(0);
    });

    it('returns null for an unknown hash', async () => {
      const store = await make();
      expect(await store.findSession('nope')).toBeNull();
      expect(await store.revokeSession('nope')).toBeNull();
    });
  });
}

suite('Store on PGlite', pglite, false);
suite('Store on Postgres', postgres, !process.env.LEDGE_RELAY_TEST_DATABASE_URL);
