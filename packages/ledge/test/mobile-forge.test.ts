// Pull and merge requests on the phone (refonte mobile B5, docs/mobile-forge-contract.md): the daemon's list without the CLIs' messages,
// the detail cut to fit the frame, and every action behind the device's check over that very request and action.
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  PHONE_FORGE_BYTES, PHONE_FORGE_TEXT_MAX, PhoneClientMessageSchema, PhoneServerMessageSchema,
  type ClientMessage, type ForgeAction, type ForgeStateMessage, type PrDetail, type PullRequest, type ServerMessage
} from '@ledge/protocol';
import { forgeSubject, phoneForgeDetail, phoneForgeState } from '../src/mobile/forge.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const PR: PullRequest = {
  id: 'github.com/acme/shop#226', forge: 'github', host: 'github.com', repo: 'acme/shop', number: 226, ref: '#226', url: 'https://github.com/acme/shop/pull/226',
  title: 'Fix the cart', state: 'open', branch: 'fix/cart', target: 'main', headSha: 'abc1234', pipeline: 'ok', approvals: { given: 1 }, mergeable: true,
  openThreads: 1, updatedAt: '2026-11-10T20:00:00.000Z', sessions: ['local:s1']
};
const STATE: ForgeStateMessage = {
  type: 'forge.state', prs: [PR],
  forges: [{ forge: 'gitlab', host: 'gitlab.corp', status: 'error', message: 'dial tcp: proxy refused for /home/me/.config/glab-cli', at: '2026-11-10T20:00:00.000Z', since: '2026-11-10T19:00:00.000Z', retryAt: '2026-11-10T20:10:00.000Z' }],
  followed: [{ session: 'local:s1', forge: 'github', host: 'github.com', repo: 'acme/shop' }]
};
const DETAIL: PrDetail = {
  pr: PR, description: 'Fixes the cart total.', author: 'me', reviewers: [{ name: 'ana', state: 'approved' }], labels: [], issues: ['#38'],
  jobs: [{ id: '1', name: 'test', column: 0, columnName: 'CI', status: 'ok', durationS: 42 }],
  threads: [{ id: 't1', resolvable: true, resolved: false, file: 'cart.ts', line: 3, comments: [{ id: 'c1', author: 'ana', at: '2026-11-10T19:00:00.000Z', body: 'Why?' }] }],
  files: [{ path: 'cart.ts', added: 2, removed: 1, patch: '@@ -1 +1 @@' }], commits: [{ sha: 'abc1234', title: 'fix', author: 'me', at: '2026-11-10T18:00:00.000Z' }],
  mergeCommand: 'gh pr merge 226 --repo acme/shop --squash', mergeBlockers: []
};

/** A gateway over a daemon whose forge answers as `answer` says; `acts` are the actions that reached the daemon. */
function make(o: { forge?: false; detail?: (msg: Extract<ClientMessage, { type: 'forge.detail' }>) => ServerMessage | null; act?: (msg: Extract<ClientMessage, { type: 'forge.act' }>) => ServerMessage } = {}) {
  const acts: Extract<ClientMessage, { type: 'forge.act' }>[] = [];
  const dispatch = async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
    if (msg.type === 'forge.detail') { const r = o.detail ? o.detail(msg) : { type: 'forge.detail.reply' as const, requestId: msg.requestId, ok: true, detail: DETAIL }; if (r) reply(r); }
    if (msg.type === 'forge.act') { acts.push(msg); reply(o.act ? o.act(msg) : { type: 'forge.act.reply', requestId: msg.requestId, ok: true, command: 'gh pr comment 226 --repo acme/shop --body-file -' }); }
  };
  const g = setup({ dispatch, deps: o.forge === false ? {} : { forge: { state: () => STATE } } });
  return { g, acts };
}

const enroll = async (g: ReturnType<typeof setup>) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const prove = async (g: ReturnType<typeof setup>, auth: ReturnType<typeof softAuthenticator>, prId: string, action: ForgeAction, counter: number) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'forge', forge: { prId, action } });
  await flush();
  const ch = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
  if (ch?.type !== 'confirm.challenge') throw new Error(`no challenge: ${JSON.stringify(ch)}`);
  return auth.get(rp, ch.challenge, { counter });
};
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
const act = async (g: ReturnType<typeof setup>, msg: object, op = randomUUID()) => {
  g.send('dev1', { type: 'forge.act', op, ...msg });
  await until(() => g.got('dev1').some(m => m.type === 'forge.done' && m.op === op));
  return { result: g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1), done: g.got('dev1').find(m => m.type === 'forge.done' && m.op === op) };
};

describe('phone forge: the list', () => {
  it('daemon.forge, then the list on forge.state and each change after it, never a CLI message', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon.forge).toBe(true);
    g.send('dev1', { type: 'forge.state' });
    await flush();
    const first = g.got('dev1').filter(m => m.type === 'forge.state');
    expect(first).toHaveLength(1);
    expect(PhoneServerMessageSchema.parse(first[0])).toEqual({ type: 'forge.state', prs: [PR], forges: [{ forge: 'gitlab', host: 'gitlab.corp', status: 'error', at: STATE.forges[0]!.at, since: STATE.forges[0]!.since, retryAt: STATE.forges[0]!.retryAt }], followed: STATE.followed });
    expect(JSON.stringify(first[0])).not.toContain('/home/me');
    g.gw.forward({ ...STATE, prs: [{ ...PR, pipeline: 'run' }] });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'forge.state').at(-1)).toMatchObject({ prs: [{ pipeline: 'run' }] });
  });

  it('a device that did not ask gets no change; a PC without a forge has no flag and refuses the reads', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.gw.forward(STATE);
    await flush();
    expect(g.got('dev1').some(m => m.type === 'forge.state')).toBe(false);
    const bare = make({ forge: false });
    bare.g.send('dev1', { type: 'snapshot.request' });
    bare.g.send('dev1', { type: 'forge.state' });
    bare.g.send('dev1', { type: 'forge.detail', prId: PR.id });
    await flush();
    const snap = bare.g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon.forge).toBeUndefined();
    expect(bare.g.got('dev1').filter(m => m.type === 'error')).toEqual([{ type: 'error', code: 'invalid', request: 'forge.state' }, { type: 'error', code: 'invalid', request: 'forge.detail' }]);
  });
});

describe('phone forge: the detail', () => {
  it('the Desktop\'s detail with the job log asked; not followed is unavailable, gh failing is failed', async () => {
    const asked: Array<string | undefined> = [];
    let answer: 'ok' | 'gone' | 'broken' = 'ok';
    const { g } = make({ detail: m => { asked.push(m.log); return answer === 'ok' ? { type: 'forge.detail.reply', requestId: m.requestId, ok: true, detail: { ...DETAIL, log: { jobId: '1', text: 'ok' } } }
      : { type: 'forge.detail.reply', requestId: m.requestId, ok: false, ...(answer === 'gone' ? { code: 'unavailable' as const } : {}), message: 'gh: HTTP 502 for /home/me' }; } });
    g.send('dev1', { type: 'forge.detail', prId: PR.id, log: '1' });
    await until(() => g.got('dev1').some(m => m.type === 'forge.detail'));
    expect(PhoneServerMessageSchema.parse(g.got('dev1').find(m => m.type === 'forge.detail'))).toEqual({ type: 'forge.detail', prId: PR.id, detail: { ...DETAIL, log: { jobId: '1', text: 'ok' } } });
    expect(asked).toEqual(['1']);
    answer = 'gone';
    g.send('dev1', { type: 'forge.detail', prId: PR.id });
    answer = 'gone';
    await until(() => g.got('dev1').filter(m => m.type === 'forge.detail').length === 2);
    answer = 'broken';
    g.send('dev1', { type: 'forge.detail', prId: PR.id });
    await until(() => g.got('dev1').filter(m => m.type === 'forge.detail').length === 3);
    const errors = g.got('dev1').filter(m => m.type === 'forge.detail').slice(1);
    expect(errors).toEqual([{ type: 'forge.detail', prId: PR.id, error: 'unavailable' }, { type: 'forge.detail', prId: PR.id, error: 'failed' }]);
    expect(JSON.stringify(errors)).not.toContain('/home/me');
  });

  it('a heavy detail fits the frame: long texts shortened, then patches, then the oldest discussions go, and it says cut', () => {
    const long = 'x'.repeat(PHONE_FORGE_TEXT_MAX + 10);
    const light = phoneForgeDetail({ ...DETAIL, description: long });
    expect(light.cut).toBe(true);
    expect(light.detail.description).toHaveLength(PHONE_FORGE_TEXT_MAX);
    expect(light.detail.files[0]!.patch).toBe('@@ -1 +1 @@');
    expect(phoneForgeDetail(DETAIL)).toEqual({ detail: DETAIL, cut: false });

    const patch = 'y'.repeat(300_000);
    const thread = (i: number) => ({ id: `t${i}`, resolvable: true, resolved: false, comments: [{ id: `c${i}`, author: 'ana', at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), body: 'z'.repeat(7000) }] });
    const heavy = phoneForgeDetail({ ...DETAIL, files: [1, 2, 3].map(i => ({ path: `f${i}`, added: 1, removed: 0, patch })), threads: Array.from({ length: 200 }, (_, i) => thread(i)) });
    expect(heavy.cut).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(heavy.detail))).toBeLessThanOrEqual(PHONE_FORGE_BYTES);
    expect(heavy.detail.files.every(f => f.patch === undefined)).toBe(true);
    expect(heavy.detail.threads.length).toBeGreaterThan(50);
    expect(heavy.detail.threads.length).toBeLessThan(200);
    // The newest discussions stay, in the forge's order.
    expect(heavy.detail.threads.at(-1)!.id).toBe('t199');
    expect(heavy.detail.threads.some(t => t.id === 't0')).toBe(false);
  });
});

describe('phone forge: the actions', () => {
  it('each action needs the device\'s check over that request and action; then the Desktop\'s act runs once, and its command comes back', async () => {
    const { g, acts } = make();
    const comment: ForgeAction = { kind: 'comment', body: 'LGTM' };
    expect(await act(g, { prId: PR.id, action: comment })).toMatchObject({ result: { status: 'rejected', reason: 'confirm_required' }, done: { ok: false, rejected: 'confirm_required' } });
    const auth = await enroll(g);
    // Signed for one comment, sent with another.
    const assertion = await prove(g, auth, PR.id, comment, 1);
    expect(await act(g, { prId: PR.id, action: { kind: 'comment', body: 'Merge it now' }, assertion })).toMatchObject({ result: { reason: 'assertion_invalid' }, done: { rejected: 'assertion_invalid' } });
    expect(acts).toEqual([]);
    const op = randomUUID();
    const ok = await act(g, { prId: PR.id, action: comment, assertion: await prove(g, auth, PR.id, comment, 2) }, op);
    expect(ok.result).toMatchObject({ status: 'applied' });
    expect(PhoneServerMessageSchema.parse(ok.done)).toEqual({ type: 'forge.done', op, ok: true, command: 'gh pr comment 226 --repo acme/shop --body-file -' });
    expect(acts).toEqual([expect.objectContaining({ type: 'forge.act', prId: PR.id, action: comment })]);
    // The same operation again: its end again, no second comment.
    g.send('dev1', { type: 'forge.act', op, prId: PR.id, action: comment });
    await until(() => g.got('dev1').filter(m => m.type === 'forge.done' && m.op === op).length === 2);
    expect(acts).toHaveLength(1);
  });

  it('a challenge only for a request this PC follows', async () => {
    const { g } = make();
    await enroll(g);
    g.send('dev1', { type: 'confirm.prepare', purpose: 'forge', forge: { prId: 'github.com/acme/other#1', action: { kind: 'rerun' } } });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
  });

  it('the daemon\'s refusals come back as their codes; a failure carries gh\'s line, shortened', async () => {
    let reply: { code?: 'stale' | 'busy' | 'not_offered' | 'unavailable'; message: string } = { code: 'stale', message: 'the request has new commits since you saw it' };
    const { g } = make({ act: m => ({ type: 'forge.act.reply', requestId: m.requestId, ok: false, ...reply }) });
    const auth = await enroll(g);
    const merge: ForgeAction = { kind: 'merge', headSha: 'abc1234' };
    let counter = 0;
    for (const code of ['stale', 'busy', 'not_offered', 'unavailable'] as const) {
      reply = { code, message: 'whatever the daemon says' };
      const r = await act(g, { prId: PR.id, action: merge, assertion: await prove(g, auth, PR.id, merge, ++counter) });
      expect(r.result).toMatchObject({ status: 'rejected', reason: code });
      expect(r.done).toEqual({ type: 'forge.done', op: expect.any(String), ok: false, error: code });
    }
    reply = { message: `glab: ${'e'.repeat(900)}` };
    const r = await act(g, { prId: PR.id, action: merge, assertion: await prove(g, auth, PR.id, merge, ++counter) });
    expect(r.result).toMatchObject({ status: 'failed' });
    expect(PhoneServerMessageSchema.parse(r.done)).toMatchObject({ ok: false, error: 'failed', message: `glab: ${'e'.repeat(494)}` });
  });

  it('a PC without a forge refuses the action as unavailable', async () => {
    const { g } = make({ forge: false });
    expect(await act(g, { prId: PR.id, action: { kind: 'rerun' } })).toMatchObject({ result: { status: 'rejected', reason: 'unavailable' }, done: { rejected: 'unavailable' } });
  });
});

describe('phone forge: the messages', () => {
  it('only the Desktop\'s actions, strict; the subject covers the whole action', () => {
    const base = { type: 'forge.act', op: randomUUID(), prId: PR.id };
    expect(PhoneClientMessageSchema.safeParse({ ...base, action: { kind: 'resolve', threadId: 't1' } }).success).toBe(true);
    expect(PhoneClientMessageSchema.safeParse({ ...base, action: { kind: 'close' } }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ ...base, action: { kind: 'rerun' }, machineId: 'x' }).success).toBe(false);
    expect(forgeSubject(PR.id, { kind: 'reply', threadId: 't1', body: 'a' })).not.toBe(forgeSubject(PR.id, { kind: 'reply', threadId: 't1', body: 'b' }));
    expect(forgeSubject(PR.id, { kind: 'resolve', threadId: 't1' })).not.toBe(forgeSubject(`${PR.id}0`, { kind: 'resolve', threadId: 't1' }));
    expect(phoneForgeState({ type: 'forge.state', prs: [], forges: [] })).toEqual({ prs: [], forges: [], followed: [] });
  });
});
