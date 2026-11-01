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
/** `digest` is what a current gateway echoes from the prepare; without it the challenge is an older gateway's. */
const challenge = (purpose: 'define' | 'team', digest?: string) => ({ type: 'confirm.challenge' as const, purpose, challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000, ...(digest ? { digest } : {}) });
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

  it('notes a refused catalog read, and forgets it on the next read and on a catalog', () => {
    const t = setup();
    t.store.requestCatalog();
    expect(t.store.getState().catalogRefused).toBe(false);
    t.deliver({ type: 'error', code: 'invalid', request: 'teams.catalog' });
    expect(t.store.getState().catalogRefused).toBe(true);
    t.store.requestCatalog();
    expect(t.store.getState().catalogRefused).toBe(false);
    t.deliver({ type: 'error', code: 'invalid', request: 'teams.catalog' });
    t.deliver({ type: 'teams.catalog', catalog: catalog() });
    expect(t.store.getState().catalogRefused).toBe(false);
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
    const [a, b] = t.of('confirm.prepare');
    // The first call's challenge (its own digest) is not the second's.
    t.deliver(challenge('define', a!.digest));
    await flush();
    expect(t.of('role.write')).toEqual([]);
    t.deliver(challenge('define', b!.digest));
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

  it('a compose the PC saved but whose seat did not start resolves applied with a warning', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const done = t.store.teamOp({ type: 'team.compose', team: 'team-a1b2', seats: [{ role: 'lead' }] });
    await prepared(t);
    t.deliver(challenge('team'));
    await flush();
    const [sent] = t.of('team.compose');
    t.deliver({ type: 'operation.result', op: sent!.op, status: 'applied', reason: 'seat_failed' });
    await expect(done).resolves.toEqual({ status: 'applied', warn: 'seat_failed' });
  });

  it('teamOp compose resolves applied with models', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const done = t.store.teamOp({ type: 'team.compose', team: 'team-a1b2', seats: [{ role: 'lead' }] });
    await prepared(t);
    t.deliver(challenge('team'));
    await flush();
    const models = [{ role: 'lead', session: 's1', status: 'scheduled' as const }, { role: 'dev', session: 's2', status: 'refused' as const, reason: 'not_running' as const }];
    t.deliver({ type: 'operation.result', op: t.of('team.compose')[0]!.op, status: 'applied', models });
    await expect(done).resolves.toEqual({ status: 'applied', models });
  });

  it('a second template.write of the same id is sent while the first is still uncertain', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const tpl = (name: string) => ({ type: 'template.write' as const, scope: 'home' as const, id: 'duo', name, seats: [{ role: 'lead' }], base: HASH });
    void t.store.define(tpl('Duo'));
    await prepared(t);
    t.deliver(challenge('define'));
    await vi.waitFor(() => expect(t.of('template.write')).toHaveLength(1));
    // The reply is lost: the link drops and the first op stays uncertain.
    t.set('connecting' as never);
    t.set('ready');
    t.deliver(snapshot([], 'Atelier', undefined, { confirm: true, chat: true }));
    const second = t.store.define(tpl('Duo 2'));
    await prepared(t, 2);
    t.deliver(challenge('define'));
    await vi.waitFor(() => expect(t.of('template.write').map(m => m.name)).toContain('Duo 2'));
    const sent = t.of('template.write').find(m => m.name === 'Duo 2')!;
    t.deliver({ type: 'operation.result', op: sent.op, status: 'applied' });
    await expect(second).resolves.toEqual({ status: 'applied' });
  });

  /** Two defines, A superseded by B: both prepares are out, `A` and `B` are their digests. */
  async function twoCalls() {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const a = t.store.define(write('A'));
    await prepared(t);
    const b = t.store.define(write('B'));
    await prepared(t, 2);
    await expect(a).resolves.toMatchObject({ status: 'failed' });
    const [pa, pb] = t.of('confirm.prepare');
    return { t, b, A: pa!.digest!, B: pb!.digest! };
  }
  const signedOver = (challenges: string[]) => expect(vi.mocked(getAssertion).mock.calls.map(c => c[0].challenge)).toEqual(challenges);

  it('a superseded call\'s challenge does not sign the new one: A\'s late answer comes first, then B\'s', async () => {
    const { t, b, A, B } = await twoCalls();
    t.deliver({ ...challenge('define', A), challenge: 'QQ' });
    await flush();
    expect(getAssertion).not.toHaveBeenCalled();
    expect(t.of('role.write')).toEqual([]);
    t.deliver({ ...challenge('define', B), challenge: 'Qg' });
    await vi.waitFor(() => expect(t.of('role.write')).toHaveLength(1));
    signedOver(['Qg']);
    expect(t.of('role.write')[0]!.role.prompt).toBe('B');
    t.deliver({ type: 'operation.result', op: t.of('role.write')[0]!.op, status: 'applied' });
    await expect(b).resolves.toEqual({ status: 'applied' });
  });

  it('B\'s challenge arrives before A\'s late one: B is signed over its own, A\'s is ignored', async () => {
    const { t, b, A, B } = await twoCalls();
    t.deliver({ ...challenge('define', B), challenge: 'Qg' });
    await vi.waitFor(() => expect(t.of('role.write')).toHaveLength(1));
    t.deliver({ ...challenge('define', A), challenge: 'QQ' });
    await flush();
    signedOver(['Qg']);
    expect(t.of('role.write').map(m => m.role.prompt)).toEqual(['B']);
    t.deliver({ type: 'operation.result', op: t.of('role.write')[0]!.op, status: 'applied' });
    await expect(b).resolves.toEqual({ status: 'applied' });
  });

  it('a challenge of the other teams purpose, or for another digest, does not settle a team call', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const done = t.store.teamOp({ type: 'team.dissolve', team: 'team-a1b2' });
    await prepared(t);
    const [p] = t.of('confirm.prepare');
    t.deliver(challenge('define', p!.digest));
    t.deliver(challenge('team', 'f'.repeat(64)));
    await flush();
    expect(getAssertion).not.toHaveBeenCalled();
    t.deliver(challenge('team', p!.digest));
    await vi.waitFor(() => expect(t.of('team.dissolve')).toHaveLength(1));
    t.deliver({ type: 'operation.result', op: t.of('team.dissolve')[0]!.op, status: 'applied' });
    await expect(done).resolves.toEqual({ status: 'applied' });
  });

  it('a request-less error with A superseded settles only the pending B, and leaves nothing behind for the next call', async () => {
    const { t, b, A } = await twoCalls();
    t.deliver({ type: 'error', code: 'invalid' });
    await expect(b).resolves.toMatchObject({ status: 'failed' });
    expect(getAssertion).not.toHaveBeenCalled();
    // A fresh call is neither swallowed nor settled by A's late challenge.
    const c = t.store.define(write('C'));
    await prepared(t, 3);
    const C = t.of('confirm.prepare')[2]!.digest;
    t.deliver({ ...challenge('define', A), challenge: 'QQ' });
    await flush();
    expect(getAssertion).not.toHaveBeenCalled();
    t.deliver({ ...challenge('define', C), challenge: 'Qw' });
    await vi.waitFor(() => expect(t.of('role.write')).toHaveLength(1));
    signedOver(['Qw']);
    expect(t.of('role.write')[0]!.role.prompt).toBe('C');
    t.deliver({ type: 'operation.result', op: t.of('role.write')[0]!.op, status: 'applied' });
    await expect(c).resolves.toEqual({ status: 'applied' });
  });

  it('a challenge without a credential is confirm_required, with no passkey prompt', async () => {
    const t = setup();
    const done = t.store.define(write('x'));
    await prepared(t);
    const { credentialId: _c, ...bare } = challenge('define');
    t.deliver(bare);
    await expect(done).resolves.toEqual({ status: 'rejected', reason: 'confirm_required' });
    expect(getAssertion).not.toHaveBeenCalled();
    expect(t.of('role.write')).toEqual([]);
  });

  it('an operation that cannot be written after the passkey is failed, not expired', async () => {
    const t = setup();
    vi.mocked(getAssertion).mockImplementation(async () => { t.set('connecting' as never); return ASSERTION; });
    const done = t.store.define(write('x'));
    await prepared(t);
    t.deliver(challenge('define'));
    await expect(done).resolves.toEqual({ status: 'failed' });
    expect(t.of('role.write')).toEqual([]);
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
