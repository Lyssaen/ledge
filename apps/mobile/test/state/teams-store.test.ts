import { afterEach, describe, expect, it, vi } from 'vitest';
import { teamsDigest, type PhoneCatalog, type PhoneRole } from '@ledge/protocol';
import { createStore, type MobileStore } from '../../src/state/store';
import { getAssertion } from '../../src/link/webauthn';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

const stores: MobileStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.mocked(getAssertion).mockReset();
});

function setup(device: { confirm: boolean; chat?: true } = { confirm: true, chat: true }) {
  const f = fakeLink('ready');
  const store = createStore(f.link, new MemoryStorage());
  stores.push(store);
  f.deliver(snapshot([], 'Atelier', undefined, device));
  return { ...f, store };
}

const flush = () => new Promise(r => setTimeout(r, 0));
/** The digest is computed asynchronously: the challenge is asked once it is. */
const prepared = (t: { of: (type: 'confirm.prepare') => unknown[] }, n = 1) => vi.waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(n));
const ASSERTION = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const challenge = (purpose: 'define' | 'team') => ({ type: 'confirm.challenge' as const, purpose, challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 });
const HASH = 'a'.repeat(16);
const write = (prompt: string) => ({ type: 'role.write' as const, scope: 'home' as const, role: { id: 'lead', label: 'Chef', prompt }, base: null });
const role = (over: Partial<PhoneRole> = {}): PhoneRole => ({ id: 'lead', label: 'Chef', prompt: 'p', scope: 'home', project: null, hash: HASH, ...over });
const catalog = (over: Partial<PhoneCatalog> = {}): PhoneCatalog => ({ projects: ['ledge'], roles: [role()], templates: [], problems: [], ...over });

describe('the teams catalog in the store', () => {
  it('starts null, is set by teams.catalog, asked by requestCatalog, and reset with the link', () => {
    const t = setup();
    expect(t.store.getState().catalog).toBeNull();
    t.store.requestCatalog();
    expect(t.of('teams.catalog')).toEqual([{ type: 'teams.catalog' }]);
    t.deliver({ type: 'teams.catalog', catalog: catalog() });
    expect(t.store.getState().catalog?.roles).toHaveLength(1);
    t.setPairing({ step: 'committing' });
    t.set('unpaired');
    expect(t.store.getState().catalog).toBeNull();
  });

  it('readRole resolves on the teams.role of that id, and rejects on an error frame', async () => {
    const t = setup();
    const read = t.store.readRole({ scope: 'home', id: 'lead' });
    expect(t.of('teams.role')).toEqual([{ type: 'teams.role', scope: 'home', id: 'lead' }]);
    t.deliver({ type: 'teams.role', role: role({ id: 'other' }) });
    t.deliver({ type: 'teams.role', role: role({ prompt: 'whole' }) });
    await expect(read).resolves.toMatchObject({ id: 'lead', prompt: 'whole' });

    const missing = t.store.readRole({ scope: 'home', id: 'gone' });
    t.deliver({ type: 'error', code: 'invalid', request: 'teams.role' });
    await expect(missing).rejects.toThrow('error');
  });

  it('readRole rejects offline and when the link is lost', async () => {
    const t = setup();
    const read = t.store.readRole({ scope: 'home', id: 'lead' });
    t.set('connecting' as never);
    await expect(read).rejects.toThrow('lost');
    await expect(t.store.readRole({ scope: 'home', id: 'lead' })).rejects.toThrow('not_ready');
  });
});

describe('define and teamOp', () => {
  it('prepares a define challenge over the digest of the request, then writes it with the assertion and no cwd', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const req = write('Tu diriges.');
    const done = t.store.define(req);
    await prepared(t);
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'define', digest: await teamsDigest(req) }]);
    t.deliver(challenge('define'));
    await flush();
    const [sent] = t.of('role.write');
    expect(sent).toMatchObject({ ...req, assertion: ASSERTION });
    expect(sent).not.toHaveProperty('cwd');
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' });
    await expect(done).resolves.toEqual({ status: 'applied' });
    // An applied define asks for the catalog again.
    expect(t.of('teams.catalog')).toHaveLength(1);
  });

  it('does not ask for the catalog again when the define was refused', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const done = t.store.define(write('x'));
    await prepared(t);
    t.deliver(challenge('define'));
    await flush();
    t.deliver({ type: 'operation.result', op: t.of('role.write')[0]!.op, status: 'rejected', reason: 'changed' });
    await expect(done).resolves.toEqual({ status: 'rejected', reason: 'changed' });
    expect(t.of('teams.catalog')).toHaveLength(0);
  });

  it('computes the digest at each call: two prompts give two different digests', async () => {
    const t = setup();
    void t.store.define(write('first'));
    await prepared(t);
    void t.store.define(write('second'));
    await prepared(t, 2);
    const [a, b] = t.of('confirm.prepare');
    expect(a!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(a!.digest).toBe(await teamsDigest(write('first')));
    expect(b!.digest).toBe(await teamsDigest(write('second')));
    expect(a!.digest).not.toBe(b!.digest);
  });

  it('an old challenge does not carry over to new content: each call prepares its own', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const first = t.store.define(write('first'));
    await prepared(t);
    const second = t.store.define(write('second'));
    await prepared(t, 2);
    await expect(first).resolves.toMatchObject({ status: 'failed' });
    t.deliver(challenge('define'));
    await flush();
    expect(t.of('role.write').map(m => m.role.prompt)).toEqual(['second']);
    t.deliver({ type: 'operation.result', op: t.of('role.write')[0]!.op, status: 'applied' });
    await expect(second).resolves.toEqual({ status: 'applied' });
  });

  it('writes the content it hashed, even when the caller edits its object after the call', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const req = write('hashed');
    void t.store.define(req);
    req.role.prompt = 'edited afterwards';
    await prepared(t);
    t.deliver(challenge('define'));
    await flush();
    expect(t.of('role.write').map(m => m.role.prompt)).toEqual(['hashed']);
    expect(t.of('confirm.prepare')[0]!.digest).toBe(await teamsDigest(write('hashed')));
  });

  it('without device.confirm, define resolves confirm_required and sends nothing', async () => {
    const t = setup({ confirm: false, chat: true });
    await expect(t.store.define(write('x'))).resolves.toEqual({ status: 'rejected', reason: 'confirm_required' });
    expect(t.sent.filter(m => m.type !== 'chat.history')).toEqual([]);
    expect(getAssertion).not.toHaveBeenCalled();
  });

  it('a request teamsDigest refuses resolves rejected invalid and sends nothing', async () => {
    const t = setup();
    const bad = { ...write('x'), extra: 1 } as never;
    await expect(t.store.define(bad)).resolves.toEqual({ status: 'rejected', reason: 'invalid' });
    expect(t.of('confirm.prepare')).toEqual([]);
    expect(t.of('role.write')).toEqual([]);
    expect(getAssertion).not.toHaveBeenCalled();
  });

  it('teamOp uses the team purpose and sends the team operation', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const req = { type: 'team.dissolve' as const, team: 'team-a1b2' };
    const done = t.store.teamOp(req);
    await prepared(t);
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'team', digest: await teamsDigest(req) }]);
    t.deliver(challenge('team'));
    await flush();
    const [sent] = t.of('team.dissolve');
    expect(sent).toMatchObject({ team: 'team-a1b2', assertion: ASSERTION });
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied' });
    await expect(done).resolves.toEqual({ status: 'applied' });
    expect(t.of('teams.catalog')).toHaveLength(0);
  });

  it('a cancelled passkey sends nothing', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    const done = t.store.define(write('x'));
    await prepared(t);
    t.deliver(challenge('define'));
    await expect(done).resolves.toEqual({ status: 'cancelled' });
    expect(t.of('role.write')).toEqual([]);
  });
});
