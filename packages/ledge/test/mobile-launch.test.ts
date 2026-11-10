// « Nouvelle session » from the phone (refonte mobile M2 §9, docs/mobile-launch-contract.md): only a project's folders of this PC,
// the passkey over that very launch, and the new session's id in the result.
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhoneClientMessageSchema, PhoneServerMessageSchema, type PhoneLaunch, type Projects, type RepoInfo } from '@ledge/protocol';
import { createPhoneGateway, PhoneLaunchRefused } from '../src/mobile/gateway.js';
import { phoneLaunch } from '../src/mobile/launch.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

type G = ReturnType<typeof setup>;
type Req = Parameters<NonNullable<Parameters<typeof createPhoneGateway>[0]['launch']>>[0];
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };

function make(o: { launch?: (req: Req) => Promise<{ id: string }>; noLaunch?: boolean; inspect?: (paths: string[]) => Promise<RepoInfo[]> } = {}) {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'ledge-phone-launch-')));
  const api = join(h, 'code', 'api'); const web = join(h, 'code', 'web');
  mkdirSync(api, { recursive: true }); mkdirSync(web, { recursive: true });
  writeFileSync(join(h, 'x'), '');
  const projects: Projects = {
    projects: [{ id: 'shop', name: 'Shop', color: 'blue', description: '', repos: [{ machine: 'local', path: api }, { machine: 'local', path: web }, { machine: 'srv', path: '/srv/shop' }] }],
    rules: []
  };
  const launched: Req[] = [];
  const launch = o.launch ?? (async () => ({ id: 'local:new-1' }));
  const g = setup({ deps: {
    projects: () => projects,
    folders: { home: h, recents: () => [], machineLabel: () => 'Serveur', ...(o.inspect ? { inspect: o.inspect } : {}) },
    ...(o.noLaunch ? {} : { launch: async (req: Req) => { launched.push(req); return launch(req); } })
  } });
  return { g, h, api, web, launched };
}

const outcome = (g: G, op: string) => g.results('dev1').filter(r => r.type === 'operation.result' && r.op === op && r.status !== 'received').at(-1);
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
const send = async (g: G, msg: object, op = randomUUID()) => { g.send('dev1', { ...msg, op }); await until(() => !!outcome(g, op)); return outcome(g, op); };

const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
/** The phone's check over `launch`, as it asks for it before « Lancer ». */
const prove = async (g: G, auth: ReturnType<typeof softAuthenticator>, launch: PhoneLaunch, counter: number) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'launch', launch });
  await flush();
  const ch = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
  if (ch?.type !== 'confirm.challenge') throw new Error(`no challenge: ${JSON.stringify(ch)}`);
  return auth.get(rp, ch.challenge, { counter });
};

describe('phone « Nouvelle session »', () => {
  it('with the passkey over that launch: started, the result names the new session; the PC gets the form\'s fields', async () => {
    const { g, api, web, launched } = make();
    const auth = await enroll(g);
    const launch: PhoneLaunch = { project: 'shop', tool: 'claude', folders: [api, web], prompt: 'Fix the failing tests', model: 'opus', effort: 'high' };
    const r = await send(g, { type: 'session.launch', launch, assertion: await prove(g, auth, launch, 1) });
    expect(PhoneServerMessageSchema.parse(r)).toEqual({ type: 'operation.result', op: expect.any(String), status: 'applied', id: 'local:new-1' });
    expect(launched).toEqual([{ tool: 'claude', cwd: api, dirs: [web], prompt: 'Fix the failing tests', model: 'opus', effort: 'high' }]);
  });

  it('the same operation again is its result again, not a second session', async () => {
    const { g, api, launched } = make();
    const auth = await enroll(g);
    const launch: PhoneLaunch = { project: 'shop', tool: 'omp', folders: [api], prompt: 'Go', approval: 'write' };
    const msg = { type: 'session.launch', launch, assertion: await prove(g, auth, launch, 1) };
    const op = randomUUID();
    await send(g, msg, op);
    g.send('dev1', { ...msg, op });
    await until(() => g.results('dev1').filter(x => x.op === op && x.status === 'applied').length === 2);
    expect(g.results('dev1').filter(x => x.op === op && x.status === 'applied')).toEqual([expect.objectContaining({ id: 'local:new-1' }), expect.objectContaining({ id: 'local:new-1' })]);
    expect(launched).toEqual([{ tool: 'omp', cwd: api, prompt: 'Go', approval: 'write' }]);
  });

  it('no passkey, none sent, or one made for another launch: refused, nothing started', async () => {
    const { g, api, launched } = make();
    const launch: PhoneLaunch = { project: 'shop', tool: 'claude', folders: [api], prompt: 'Go' };
    expect(await send(g, { type: 'session.launch', launch })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const auth = await enroll(g);
    expect(await send(g, { type: 'session.launch', launch })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    // Signed for one first message, sent with another.
    const assertion = await prove(g, auth, launch, 1);
    expect(await send(g, { type: 'session.launch', launch: { ...launch, prompt: 'rm -rf everything' }, assertion })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(launched).toEqual([]);
  });

  it('only the project\'s folders of this PC: another folder, another machine\'s or an unknown project is stale; a challenge is not even issued for an unknown project', async () => {
    const { g, h, api, launched } = make();
    const auth = await enroll(g);
    const bad: PhoneLaunch[] = [
      { project: 'shop', tool: 'claude', folders: [h], prompt: 'Go' },
      { project: 'shop', tool: 'claude', folders: ['/srv/shop'], prompt: 'Go' },
      { project: 'shop', tool: 'claude', folders: [api, h], prompt: 'Go' }
    ];
    let counter = 0;
    for (const launch of bad) expect(await send(g, { type: 'session.launch', launch, assertion: await prove(g, auth, launch, ++counter) })).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(await send(g, { type: 'session.launch', launch: { project: 'gone', tool: 'claude', folders: [api], prompt: 'Go' } })).toMatchObject({ status: 'rejected', reason: 'stale' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'launch', launch: { project: 'gone', tool: 'claude', folders: [api], prompt: 'Go' } });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(launched).toEqual([]);
  });

  it('what the agent does not take is invalid: two folders for Codex, a folder twice, an approval mode for Claude Code', async () => {
    const { g, api, web, launched } = make();
    const auth = await enroll(g);
    const bad: PhoneLaunch[] = [
      { project: 'shop', tool: 'codex', folders: [api, web], prompt: 'Go' },
      { project: 'shop', tool: 'claude', folders: [api, api], prompt: 'Go' },
      { project: 'shop', tool: 'claude', folders: [api], prompt: 'Go', approval: 'yolo' }
    ];
    let counter = 0;
    for (const launch of bad) expect(await send(g, { type: 'session.launch', launch, assertion: await prove(g, auth, launch, ++counter) })).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(launched).toEqual([]);
  });

  it('the PC\'s refusal comes back as its code (a folder gone: not_found); a launch that breaks is failed', async () => {
    let next: () => Promise<{ id: string }> = async () => { throw new PhoneLaunchRefused('not_found', 'no such folder'); };
    const { g, api } = make({ launch: () => next() });
    const auth = await enroll(g);
    const launch: PhoneLaunch = { project: 'shop', tool: 'claude', folders: [api], prompt: 'Go' };
    expect(await send(g, { type: 'session.launch', launch, assertion: await prove(g, auth, launch, 1) })).toMatchObject({ status: 'rejected', reason: 'not_found' });
    next = async () => { throw new Error('tmux: no server'); };
    expect(await send(g, { type: 'session.launch', launch, assertion: await prove(g, auth, launch, 2) })).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('the snapshot says daemon.launch when the PC can launch for the phone, and not otherwise', async () => {
    const flag = async (g: G) => {
      g.send('dev1', { type: 'snapshot.request' });
      await flush();
      const snap = g.got('dev1').find(m => m.type === 'snapshot');
      return snap?.type === 'snapshot' ? snap.daemon.launch : 'no snapshot';
    };
    expect(await flag(make().g)).toBe(true);
    expect(await flag(make({ noLaunch: true }).g)).toBeUndefined();
  });

  it('a PC that cannot launch for the phone says unavailable', async () => {
    const { g, api } = make({ noLaunch: true });
    expect(await send(g, { type: 'session.launch', launch: { project: 'shop', tool: 'claude', folders: [api], prompt: 'Go' } })).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });

  it('the message: a first message is required, and nothing but the form\'s fields', () => {
    const base = { type: 'session.launch', op: randomUUID(), launch: { project: 'shop', tool: 'claude', folders: ['/a'], prompt: 'Go' } };
    expect(PhoneClientMessageSchema.safeParse(base).success).toBe(true);
    expect(PhoneClientMessageSchema.safeParse({ ...base, launch: { ...base.launch, prompt: '   ' } }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ ...base, launch: { ...base.launch, folders: [] } }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ ...base, launch: { ...base.launch, cwd: '/etc' } }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ ...base, launch: { ...base.launch, folders: ['relative'] } }).success).toBe(false);
  });
});

describe('phone « Où travailler »: a project\'s folders with their branch', () => {
  it('this PC\'s folders carry whether they exist and their branch; another machine\'s none; without git, the list still comes', async () => {
    const { g, api, web } = make({ inspect: async paths => paths.map(path => ({ path, exists: path !== web, branch: path === api ? 'main' : null })) });
    g.send('dev1', { type: 'project.folders', id: 'shop' });
    await until(() => g.got('dev1').some(m => m.type === 'project.folders'));
    expect(PhoneServerMessageSchema.parse(g.got('dev1').find(m => m.type === 'project.folders'))).toEqual({ type: 'project.folders', id: 'shop', folders: [
      { machine: 'local', path: api, exists: true, branch: 'main' },
      { machine: 'local', path: web, exists: false, branch: null },
      { machine: 'srv', label: 'Serveur', path: '/srv/shop' }
    ] });

    const broken = make({ inspect: async () => { throw new Error('git'); } });
    broken.g.send('dev1', { type: 'project.folders', id: 'shop' });
    await until(() => broken.g.got('dev1').some(m => m.type === 'project.folders'));
    expect(broken.g.got('dev1').find(m => m.type === 'project.folders')).toMatchObject({ folders: [{ path: broken.api }, { path: broken.web }, { path: '/srv/shop' }] });
  });
});

describe('the PC side of a phone launch (phoneLaunch)', () => {
  it('a folder not there is not_found, the home folder is invalid, an option the agent does not take is invalid, a broken launch throws as is', async () => {
    const h = realpathSync(mkdtempSync(join(tmpdir(), 'ledge-phone-launch-pc-')));
    const api = join(h, 'api'); mkdirSync(api);
    const calls: string[] = [];
    let fail: Error | null = null;
    const run = phoneLaunch(async req => { calls.push(req.cwd); if (fail) throw fail; return { id: 'local:s1' } as never; }, h);
    expect(await run({ tool: 'claude', cwd: api, prompt: 'Go' })).toEqual({ id: 'local:s1' });
    await expect(run({ tool: 'claude', cwd: api, dirs: [join(h, 'gone')], prompt: 'Go' })).rejects.toMatchObject({ name: 'PhoneLaunchRefused', reason: 'not_found' });
    await expect(run({ tool: 'claude', cwd: h, prompt: 'Go' })).rejects.toMatchObject({ reason: 'invalid' });
    fail = new Error('launch: codex takes its effort in the model id');
    await expect(run({ tool: 'codex', cwd: api, prompt: 'Go', effort: 'high' })).rejects.toMatchObject({ reason: 'invalid' });
    fail = new Error('tmux: no server');
    await expect(run({ tool: 'claude', cwd: api, prompt: 'Go' })).rejects.toThrow('tmux: no server');
    expect(calls).toEqual([api, api, api]);
  });
});
